// POST /functions/v1/delete-account  { "confirm": "DELETE" }  ->  204
// Deletes the signed-in person's auth user. Every table references it with ON DELETE CASCADE, so
// profile, chats, summaries, feedback, consents and usage all go with it; rule events stay but are
// no longer linked to anyone (checked by the database tests).
// GET /functions/v1/health  ->  { ok, checks } for monitoring. No user data, no AI call.
import { bearerToken } from "./auth.ts";
import { AppError, errorReason, toAppError } from "./errors.ts";
import { corsHeaders, errorResponse, json, preflight, readJsonObject } from "./http.ts";
import type { ChatDeps } from "./chat.ts";

type Deps = Pick<ChatDeps, "config" | "repo" | "verify" | "log" | "now">;

export function createDeleteAccountHandler(deps: Deps): (request: Request) => Promise<Response> {
  return async (request) => {
    const cors = corsHeaders(request.headers.get("origin"), deps.config.allowedOrigins);
    if (request.method === "OPTIONS") return preflight(cors);
    try {
      if (request.method !== "POST") throw new AppError("bad_request", "Use POST.");
      const user = await deps.verify(bearerToken(request));
      const body = await readJsonObject(request, 1024);
      if (body.confirm !== "DELETE") throw new AppError("bad_request", 'Type DELETE to confirm.');
      await deps.repo.deleteAuthUser(user.id);
      deps.log.info("account_deleted", { guest: user.isAnonymous });
      return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
    } catch (error) {
      const failure = toAppError(error);
      if (failure.code === "internal") deps.log.error("delete_failed", { reason: errorReason(error) });
      return errorResponse(failure, cors);
    }
  };
}

export function createHealthHandler(deps: Deps & { llmConfigured: boolean }): (request: Request) => Promise<Response> {
  return async (request) => {
    const cors = corsHeaders(request.headers.get("origin"), deps.config.allowedOrigins, "GET, OPTIONS");
    if (request.method === "OPTIONS") return preflight(cors);
    const started = deps.now();
    let database = false;
    try {
      await deps.repo.ping();
      database = true;
    } catch {
      database = false;
    }
    const ok = database;
    return json(
      {
        ok,
        time: new Date(deps.now()).toISOString(),
        checks: { database, ai_configured: deps.llmConfigured, ai_enabled: deps.config.aiEnabled },
        latency_ms: deps.now() - started,
      },
      ok ? 200 : 503,
      cors,
    );
  };
}
