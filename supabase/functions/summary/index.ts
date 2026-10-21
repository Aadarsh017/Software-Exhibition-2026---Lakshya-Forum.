// POST /functions/v1/summary — the visit summary for a doctor. Logic is in ../_shared/summary.ts.
import { createSummaryHandler } from "../_shared/summary.ts";
import { buildRuntime, lazyHandler } from "../_shared/runtime.ts";

Deno.serve(lazyHandler("summary", () => createSummaryHandler(buildRuntime("summary", (name) => Deno.env.get(name)))));
