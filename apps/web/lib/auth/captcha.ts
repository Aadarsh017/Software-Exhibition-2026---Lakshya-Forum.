// Cloudflare Turnstile (security review 2026-10-20, PLAN.md §12). Once CAPTCHA is on in Supabase Auth, starting a
// guest and sending a sign-in code each need a fresh one-use token. The widget is "Managed" and shown only when
// Cloudflare wants a click (appearance "interaction-only"), so almost everyone sees nothing. Off, returning no token,
// until NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = {
  render(container: HTMLElement, options: Record<string, unknown>): string | undefined;
  remove(widgetId: string): void;
};

/** What a failed check looks like to the sign-in code: the same shape as Supabase's own error. */
export const CAPTCHA_FAILED = { code: "captcha_failed", message: "The person check did not finish." } as const;

let loading: Promise<Turnstile> | null = null;

function loadTurnstile(): Promise<Turnstile> {
  const ready = (window as unknown as { turnstile?: Turnstile }).turnstile;
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT;
    script.async = true;
    script.onload = () => {
      const loaded = (window as unknown as { turnstile?: Turnstile }).turnstile;
      if (loaded) resolve(loaded);
      else reject(new Error("turnstile_missing"));
    };
    script.onerror = () => reject(new Error("turnstile_blocked"));
    document.head.append(script);
  }).catch((error: unknown) => {
    loading = null; // a later tap tries again (a flaky network, or a blocker switched off)
    throw error;
  });
  return loading;
}

/**
 * A one-use token for Supabase Auth, or undefined when the check is switched off. Throws CAPTCHA_FAILED when
 * Cloudflare can't be reached or the check fails. If Cloudflare wants a click, its box appears at the bottom of the
 * screen until it is done.
 */
export async function captchaToken(action: "guest" | "email"): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  let turnstile: Turnstile;
  try {
    turnstile = await loadTurnstile();
  } catch {
    throw CAPTCHA_FAILED;
  }
  const host = document.createElement("div");
  host.className = "captcha-host";
  document.body.append(host);
  let widgetId: string | undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      // Two minutes is time enough for a click; a check that never ends must not leave the button spinning.
      const timer = window.setTimeout(() => reject(CAPTCHA_FAILED), 120_000);
      const fail = () => {
        window.clearTimeout(timer);
        reject(CAPTCHA_FAILED);
      };
      widgetId = turnstile.render(host, {
        sitekey: SITE_KEY,
        action,
        appearance: "interaction-only",
        retry: "never",
        callback: (token: string) => {
          window.clearTimeout(timer);
          resolve(token);
        },
        "error-callback": () => {
          fail();
          return true; // handled here: no console noise from Cloudflare
        },
        "expired-callback": fail,
        "timeout-callback": fail,
      });
    });
  } finally {
    if (widgetId) turnstile.remove(widgetId);
    host.remove();
  }
}
