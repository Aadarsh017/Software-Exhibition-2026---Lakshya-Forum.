// Reads a text/event-stream and calls back once per complete event. Handles any way the bytes are
// split, CRLF line ends, comment lines (": ping"), several data lines, and ignores what it does not know.
import type { ServerEvent, TurnError } from "./types.ts";

const KNOWN = new Set(["meta", "status", "red_flag", "sources", "field", "done", "error"]);

export type SseParser = { push(chunk: string): void; end(): void };

export function createSseParser(onEvent: (event: ServerEvent) => void): SseParser {
  let buffer = "";
  const dispatch = (block: string) => {
    let name = "message";
    const data: string[] = [];
    for (const raw of block.split("\n")) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (!KNOWN.has(name) || data.length === 0) return;
    try {
      onEvent({ event: name, data: JSON.parse(data.join("\n")) } as ServerEvent);
    } catch {
      // A damaged event is skipped; the final answer is still complete because fields are replaced by name.
    }
  };
  return {
    push(chunk) {
      // Normalise the whole buffer, not just the chunk: a "\r" and its "\n" can arrive in different chunks.
      buffer = (buffer + chunk).replace(/\r\n/g, "\n");
      let cut = buffer.indexOf("\n\n");
      while (cut !== -1) {
        dispatch(buffer.slice(0, cut));
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf("\n\n");
      }
    },
    end() {
      if (buffer.trim()) dispatch(buffer);
      buffer = "";
    },
  };
}

/** An error returned as plain JSON before the stream began, or a network failure. */
export class ChatRequestError extends Error {
  turnError: TurnError;
  status: number;
  constructor(status: number, turnError: TurnError) {
    super(turnError.code);
    this.name = "ChatRequestError";
    this.status = status;
    this.turnError = turnError;
  }
}

export async function errorFromResponse(response: Response): Promise<ChatRequestError> {
  let body: { error?: Record<string, unknown> } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // not JSON
  }
  const { code, message, retryable, ...extra } = (body.error ?? {}) as Record<string, unknown>;
  const known = typeof code === "string" ? (code as TurnError["code"]) : response.status === 401 ? "unauthenticated" : "internal";
  return new ChatRequestError(response.status, {
    code: known,
    message: typeof message === "string" ? message : "",
    retryable: typeof retryable === "boolean" ? retryable : response.status >= 500,
    extra,
  });
}

export type StreamOptions = {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onEvent: (event: ServerEvent) => void;
};

/** Sends the question and feeds every event to `onEvent`. Throws ChatRequestError for refusals and network trouble. */
export async function streamChat(options: StreamOptions): Promise<void> {
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(options.url, {
      method: "POST",
      headers: { ...options.headers, "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError(0, { code: "network", message: "", retryable: true, extra: {} });
  }
  if (!response.ok) throw await errorFromResponse(response);
  if (!response.body) throw new ChatRequestError(0, { code: "network", message: "", retryable: true, extra: {} });

  const parser = createSseParser(options.onEvent);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parser.push(value);
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ChatRequestError(0, { code: "network", message: "", retryable: true, extra: {} });
  }
  parser.end();
}
