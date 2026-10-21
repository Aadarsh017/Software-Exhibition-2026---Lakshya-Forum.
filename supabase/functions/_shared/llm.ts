// One adapter for any OpenAI-style chat completions API (PLAN.md 6.10), set by LLM_BASE_URL,
// LLM_API_KEY and the model names. Two calls: `complete` (whole reply, optionally JSON mode) and
// `stream` (reply piece by piece). Both have timeouts and retry once on errors that are worth
// retrying, and a stream is only retried if nothing has been delivered yet.
import type { Fetch, Usage } from "./types.ts";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmRequest = {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  json?: boolean;
  timeoutMs: number;
  /** Overrides the adapter's default number of retries (0 for time-boxed calls such as extraction). */
  retries?: number;
  signal?: AbortSignal;
};

export type LlmResult = { text: string; usage: Usage; model: string; finishReason: string | null };

export type Llm = {
  complete(request: LlmRequest): Promise<LlmResult>;
  stream(request: LlmRequest & { firstTokenTimeoutMs: number; onDelta: (text: string) => void }): Promise<LlmResult>;
};

export class LlmError extends Error {
  status: number | null;
  retryable: boolean;
  reason: string;
  constructor(reason: string, status: number | null, retryable: boolean) {
    super(`llm_${reason}`);
    this.name = "LlmError";
    this.reason = reason;
    this.status = status;
    this.retryable = retryable;
  }
}

const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

function usageFrom(raw: unknown, messages: ChatMessage[], output: string): Usage {
  const usage = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tokensIn = Number(usage.prompt_tokens ?? usage.input_tokens);
  const tokensOut = Number(usage.completion_tokens ?? usage.output_tokens);
  return {
    tokens_in: Number.isFinite(tokensIn) ? tokensIn : estimateTokens(messages.map((m) => m.content).join("\n")),
    tokens_out: Number.isFinite(tokensOut) ? tokensOut : estimateTokens(output),
  };
}

export function createLlm(options: {
  baseUrl: string;
  apiKey: string;
  fetch: Fetch;
  maxTokensParam?: "max_tokens" | "max_completion_tokens";
  retries?: number;
  backoffMs?: number;
}): Llm {
  const retries = options.retries ?? 1;
  const backoffMs = options.backoffMs ?? 500;
  const maxTokensParam = options.maxTokensParam ?? "max_tokens";

  // `plain` drops optional extras some providers reject (JSON mode, usage in streams).
  function body(request: LlmRequest, stream: boolean, plain: boolean): string {
    const out: Record<string, unknown> = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      [maxTokensParam]: request.maxTokens,
      stream,
    };
    if (!plain && request.json) out.response_format = { type: "json_object" };
    if (!plain && stream) out.stream_options = { include_usage: true };
    return JSON.stringify(out);
  }

  async function post(payload: string, signal: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await options.fetch(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
        body: payload,
        signal,
      });
    } catch (error) {
      const timedOut = signal.aborted || (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"));
      throw new LlmError(timedOut ? "timeout" : "network", null, true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new LlmError(`http_${response.status}`, response.status, RETRY_STATUS.has(response.status));
    }
    return response;
  }

  async function withRetry(
    run: (plain: boolean) => Promise<LlmResult>,
    canRetry: () => boolean,
    outer: AbortSignal | undefined,
    maxRetries: number,
  ): Promise<LlmResult> {
    let plain = false;
    for (let attempt = 0; ; attempt++) {
      try {
        return await run(plain);
      } catch (error) {
        const llmError = error instanceof LlmError ? error : new LlmError("unexpected", null, false);
        if (outer?.aborted || !canRetry()) throw llmError;
        // Perhaps JSON mode or stream usage is not supported here: try once without, even for calls with no retries
        // (the safety extraction), or its flags would never run on such a provider (bug review 2026-10-20).
        if (llmError.status === 400 && !plain) {
          plain = true;
          continue;
        }
        if (attempt >= maxRetries || !llmError.retryable) throw llmError;
        await sleep(backoffMs * (attempt + 1));
      }
    }
  }

  return {
    complete(request) {
      return withRetry(
        async (plain) => {
          const signal = request.signal
            ? AbortSignal.any([request.signal, AbortSignal.timeout(request.timeoutMs)])
            : AbortSignal.timeout(request.timeoutMs);
          const response = await post(body(request, false, plain), signal);
          let data: Record<string, unknown>;
          try {
            data = (await response.json()) as Record<string, unknown>;
          } catch {
            throw new LlmError(signal.aborted ? "timeout" : "bad_body", null, true);
          }
          const choice = Array.isArray(data.choices) ? (data.choices[0] as Record<string, unknown>) : undefined;
          const message = choice?.message as Record<string, unknown> | undefined;
          const text = typeof message?.content === "string" ? message.content : "";
          if (!text) throw new LlmError("empty", null, true);
          return {
            text,
            usage: usageFrom(data.usage, request.messages, text),
            model: typeof data.model === "string" ? data.model : request.model,
            finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
          };
        },
        () => true,
        request.signal,
        request.retries ?? retries,
      );
    },

    stream(request) {
      let delivered = false;
      return withRetry(
        async (plain) => {
          const firstToken = new AbortController();
          const parts = [AbortSignal.timeout(request.timeoutMs), firstToken.signal];
          if (request.signal) parts.push(request.signal);
          const signal = AbortSignal.any(parts);
          const timer = setTimeout(() => firstToken.abort(), request.firstTokenTimeoutMs);
          let text = "";
          let usageRaw: unknown = null;
          let model = request.model;
          let finishReason: string | null = null;
          try {
            const response = await post(body(request, true, plain), signal);
            if (!response.body) throw new LlmError("no_body", null, true);
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let buffer = "";
            let done = false;
            while (!done) {
              let chunk: ReadableStreamReadResult<string>;
              try {
                chunk = await reader.read();
              } catch {
                throw new LlmError(signal.aborted ? "timeout" : "stream_broken", null, !delivered);
              }
              if (chunk.done) break;
              buffer += chunk.value;
              let newline = buffer.indexOf("\n");
              while (newline !== -1) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                newline = buffer.indexOf("\n");
                if (!line.startsWith("data:")) continue;
                const data = line.slice(5).trim();
                if (data === "[DONE]") {
                  done = true;
                  break;
                }
                let event: Record<string, unknown>;
                try {
                  event = JSON.parse(data) as Record<string, unknown>;
                } catch {
                  continue;
                }
                if (event.error) throw new LlmError("stream_error", null, !delivered);
                if (typeof event.model === "string") model = event.model;
                if (event.usage) usageRaw = event.usage;
                const choice = Array.isArray(event.choices) ? (event.choices[0] as Record<string, unknown> | undefined) : undefined;
                const delta = choice?.delta as Record<string, unknown> | undefined;
                if (typeof choice?.finish_reason === "string") finishReason = choice.finish_reason;
                if (typeof delta?.content === "string" && delta.content) {
                  if (!delivered) clearTimeout(timer);
                  delivered = true;
                  text += delta.content;
                  request.onDelta(delta.content);
                }
              }
            }
            if (done) await reader.cancel().catch(() => {});
          } catch (error) {
            if (error instanceof LlmError) throw error;
            throw new LlmError(signal.aborted ? "timeout" : "unexpected", null, !delivered);
          } finally {
            clearTimeout(timer);
          }
          if (!text) throw new LlmError("empty", null, !delivered);
          return { text, usage: usageFrom(usageRaw, request.messages, text), model, finishReason };
        },
        () => !delivered,
        request.signal,
        request.retries ?? retries,
      );
    },
  };
}

/** Pulls the first JSON object out of a reply, tolerating code fences or a sentence around it. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
