// A very small client for Supabase's REST (PostgREST) and Auth admin APIs, using the secret key.
// It replaces supabase-js inside the functions: fewer dependencies, a faster cold start, and every
// request is easy to test. The secret key bypasses row-level security, so every query here filters
// by user id itself (repo.ts).
import type { Fetch } from "./types.ts";

export class RestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`rest_${status}_${code}`);
    this.name = "RestError";
    this.status = status;
    this.code = code;
  }
  /** A unique-key clash only. A 409 for a missing parent row (23503) is a real failure (bug review 2026-10-20). */
  get isDuplicate(): boolean {
    return this.code === "23505" || (this.status === 409 && !/^\d{5}$/.test(this.code));
  }
}

export type RestClient = {
  get(path: string, params?: Record<string, string>): Promise<unknown>;
  post(path: string, body: unknown, options?: { params?: Record<string, string>; prefer?: string }): Promise<unknown>;
  patch(path: string, params: Record<string, string>, body: unknown): Promise<unknown>;
  del(path: string, params?: Record<string, string>): Promise<unknown>;
};

export function createRestClient(options: { supabaseUrl: string; secretKey: string; fetch: Fetch; timeoutMs?: number }): RestClient {
  const headers: Record<string, string> = { apikey: options.secretKey };
  // Legacy service-role keys are JWTs and also go in Authorization. New sb_secret_ keys are not JWTs
  // and must only be sent as apikey.
  if (options.secretKey.split(".").length === 3) headers.Authorization = `Bearer ${options.secretKey}`;

  async function call(method: string, path: string, params?: Record<string, string>, body?: unknown, prefer?: string): Promise<unknown> {
    const url = new URL(`${options.supabaseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const init: RequestInit = {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(prefer ? { Prefer: prefer } : {}),
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await options.fetch(url.toString(), init);
    const raw = await response.text();
    let parsed: unknown = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const code = parsed && typeof parsed === "object" && "code" in parsed ? String((parsed as { code: unknown }).code) : "";
      throw new RestError(response.status, code.slice(0, 20));
    }
    return parsed;
  }

  return {
    get: (path, params) => call("GET", path, params),
    post: (path, body, opts = {}) => call("POST", path, opts.params, body, opts.prefer),
    patch: (path, params, body) => call("PATCH", path, params, body, "return=minimal"),
    del: (path, params) => call("DELETE", path, params),
  };
}
