// The slice of the Deno runtime the functions use, so `tsc` can check them without Deno installed.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): unknown;
};
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
