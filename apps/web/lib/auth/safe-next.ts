// Where to go after signing in (security review 2026-10-20). Only a page inside the app: never another site, including
// the spellings browsers still follow to another host ("//evil.com", "/\evil.com", "/<tab>/evil.com"). Erasable TypeScript.

const BASE = "https://hale.invalid";

export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\s\x00-\x1f\x7f]/.test(value)) return "/app";
  try {
    const url = new URL(value, BASE);
    if (url.origin !== BASE) return "/app";
    if (url.pathname !== "/app" && !url.pathname.startsWith("/app/")) return "/app";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/app";
  }
}
