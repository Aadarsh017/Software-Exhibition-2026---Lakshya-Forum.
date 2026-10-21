// CORS, JSON responses and request parsing.
import { AppError, toAppError } from "./errors.ts";

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

/** Echoes the origin only when it is on the allow-list ("*" in the list allows any origin). */
export function corsHeaders(origin: string | null, allowed: string[], methods = "POST, OPTIONS"): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin.replace(/\/+$/, ""))) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (allowed.includes("*")) {
    headers["Access-Control-Allow-Origin"] = "*";
  }
  return headers;
}

export function preflight(cors: Record<string, string>): Response {
  return new Response(null, { status: 204, headers: cors });
}

export function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The error shape every function returns before a stream starts: { error: { code, message, retryable, ... } }. */
export function errorResponse(error: unknown, headers: Record<string, string> = {}): Response {
  const appError = toAppError(error);
  const extra: Record<string, string> = {};
  const retryAfter = appError.details.retry_after_s;
  if (typeof retryAfter === "number") extra["Retry-After"] = String(Math.ceil(retryAfter));
  return json(
    { error: { code: appError.code, message: appError.message, retryable: appError.retryable, ...appError.details } },
    appError.status,
    { ...headers, ...extra },
  );
}

/** Reads a JSON object body of at most `maxBytes`. */
export async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    throw new AppError("bad_request", "Send the request as JSON.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new AppError("bad_request", "That message is too long.");
  const raw = await readCapped(request, maxBytes);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError("bad_request", "The request was not valid JSON.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("bad_request", "The request must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

/** Reads the body as text, stopping as soon as it passes `maxBytes` (a body sent without a length can't be huge). */
async function readCapped(request: Request, maxBytes: number): Promise<string> {
  const tooLong = () => new AppError("bad_request", "That message is too long.");
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLong();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
