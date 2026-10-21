// POST /functions/v1/delete-account {"confirm":"DELETE"} — removes the signed-in person and all their data.
import { createDeleteAccountHandler } from "../_shared/account.ts";
import { buildRuntime, lazyHandler } from "../_shared/runtime.ts";

Deno.serve(lazyHandler("delete-account", () => createDeleteAccountHandler(buildRuntime("delete-account", (name) => Deno.env.get(name)))));
