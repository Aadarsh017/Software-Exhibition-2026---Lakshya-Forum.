// Builds the real dependencies (database client, AI adapter, token verifier) from the environment.
// The index.ts of each function is a few lines that call this, so everything else stays testable.
import { createTokenVerifier, type VerifyToken } from "./auth.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { json } from "./http.ts";
import { createLlm, type Llm } from "./llm.ts";
import { createLogger, type Logger } from "./log.ts";
import { createRateLimiter, type RateLimiter } from "./rate.ts";
import { createRestClient } from "./rest.ts";
import { createRestRepo } from "./repo.ts";
import type { Fetch, Repo } from "./types.ts";

export type Runtime = {
  config: Config;
  repo: Repo;
  verify: VerifyToken;
  llm: Llm | null;
  fetch: Fetch;
  log: Logger;
  rate: RateLimiter;
  now: () => number;
  newId: () => string;
  waitUntil?: (promise: Promise<unknown>) => void;
};

export function buildRuntime(
  fn: string,
  env: (name: string) => string | undefined,
  waitUntil?: (promise: Promise<unknown>) => void,
): Runtime {
  const config = loadConfig(env);
  const fetchFn: Fetch = (input, init) => fetch(input, init);
  const now = () => Date.now();
  return {
    config,
    repo: createRestRepo(createRestClient({ supabaseUrl: config.supabaseUrl, secretKey: config.secretKey, fetch: fetchFn }), now),
    verify: createTokenVerifier({ supabaseUrl: config.supabaseUrl, publishableKey: config.publishableKey, fetch: fetchFn, now }),
    llm: config.llm.baseUrl && config.llm.apiKey
      ? createLlm({ baseUrl: config.llm.baseUrl, apiKey: config.llm.apiKey, fetch: fetchFn, maxTokensParam: config.llm.maxTokensParam })
      : null,
    fetch: fetchFn,
    log: createLogger(fn),
    rate: createRateLimiter(config.ratePerMinute, now),
    now,
    newId: () => crypto.randomUUID(),
    waitUntil,
  };
}

/**
 * Creates the handler on the first request, so a missing setting gives a clear JSON answer instead of
 * a crashed function. Only the NAMES of missing settings are ever returned.
 */
export function lazyHandler(fn: string, create: () => (request: Request) => Promise<Response>): (request: Request) => Promise<Response> {
  let handler: ((request: Request) => Promise<Response>) | null = null;
  let failure: Response | null = null;
  return async (request) => {
    if (!handler && !failure) {
      try {
        handler = create();
      } catch (error) {
        const missing = error instanceof ConfigError ? error.missing : [];
        console.error(JSON.stringify({ level: "error", fn, event: "not_configured", missing }));
        failure = json({ error: { code: "internal", message: "The service is not set up yet.", retryable: false, missing } }, 500);
      }
    }
    return handler ? handler(request) : (failure as Response).clone();
  };
}
