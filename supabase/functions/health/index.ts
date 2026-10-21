// GET /functions/v1/health — is the service up? No user data, no AI call.
import { createHealthHandler } from "../_shared/account.ts";
import { buildRuntime, lazyHandler } from "../_shared/runtime.ts";

Deno.serve(
  lazyHandler("health", () => {
    const runtime = buildRuntime("health", (name) => Deno.env.get(name));
    return createHealthHandler({ ...runtime, llmConfigured: runtime.llm !== null });
  }),
);
