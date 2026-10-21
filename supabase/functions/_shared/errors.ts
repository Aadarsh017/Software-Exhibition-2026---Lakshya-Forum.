import type { ErrorCode } from "./types.ts";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  consent_required: 403,
  not_found: 404,
  bad_request: 400,
  quota_exceeded: 429,
  rate_limited: 429,
  llm_unavailable: 503,
  internal: 500,
};

const RETRYABLE: Record<ErrorCode, boolean> = {
  unauthenticated: false,
  consent_required: false,
  not_found: false,
  bad_request: false,
  quota_exceeded: false,
  rate_limited: true,
  llm_unavailable: true,
  internal: true,
};

/**
 * An error that is safe to show to the browser. `message` is plain English for the person,
 * `details` carries machine-readable extras (for example which consents are missing).
 * Never put the user's text in either.
 */
export class AppError extends Error {
  code: ErrorCode;
  status: number;
  retryable: boolean;
  details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.retryable = RETRYABLE[code];
    this.details = details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError("internal", "Something went wrong on our side. Please try again.");
}

/** A short, content-free description of an unexpected error, for logs. */
export function errorReason(error: unknown): string {
  if (error instanceof AppError) return error.code;
  if (error && typeof error === "object" && "name" in error) {
    const name = String((error as { name: unknown }).name);
    const status = "status" in error ? `_${String((error as { status: unknown }).status)}` : "";
    return `${name}${status}`.slice(0, 60);
  }
  return "unknown";
}
