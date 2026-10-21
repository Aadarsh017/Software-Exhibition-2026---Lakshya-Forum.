// POST /functions/v1/chat — one question, one streamed answer. All logic is in ../_shared/chat.ts.
import { createChatHandler } from "../_shared/chat.ts";
import { buildRuntime, lazyHandler } from "../_shared/runtime.ts";

const waitUntil = typeof EdgeRuntime !== "undefined" ? (promise: Promise<unknown>) => EdgeRuntime?.waitUntil(promise) : undefined;
Deno.serve(lazyHandler("chat", () => createChatHandler(buildRuntime("chat", (name) => Deno.env.get(name), waitUntil))));
