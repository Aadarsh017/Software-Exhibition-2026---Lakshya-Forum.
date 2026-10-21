"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { safeNext } from "@/lib/auth/safe-next";
import { createClient } from "@/lib/supabase/client";
import { friendlyAuthMessage } from "@/lib/auth-messages";
import { captchaToken } from "@/lib/auth/captcha";
import { startEmail, verifyEmail, type Mode } from "@/lib/auth/upgrade";
import { mailProviderFor } from "@/lib/auth/mail-provider";
import { GoogleIcon } from "@/components/auth/google-icon";
import { OtpInput } from "@/components/auth/otp-input";
import { LogoMark } from "@/components/nox";

function maskEmail(email: string): string {
  const [name = "", domain = ""] = email.trim().split("@");
  return `${name.slice(0, 1)}***@${domain}`;
}

// "Continue with Google" appears only once Google sign-in is switched on in Supabase (it needs a Google OAuth
// client). Set NEXT_PUBLIC_GOOGLE_ENABLED=true then. Until that, no button, so there is no dead button.
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

// Until the branded emails are live (supabase/EMAIL_SETUP.md), Supabase sends its own email, which has a link and no
// code. Then we ask people to open the link instead of showing six boxes for a code that never comes. Set
// NEXT_PUBLIC_EMAIL_CODE=true once the emails with the 6-digit code are applied.
const EMAIL_CODE = process.env.NEXT_PUBLIC_EMAIL_CODE === "true";

const small = "m-0 text-center text-[0.84375rem] leading-snug text-[var(--ink-muted)]";

function Head({ title, hidden = false, children }: { title: ReactNode; hidden?: boolean; children: ReactNode }) {
  return (
    <div className={`grid justify-items-center gap-2.5 text-center ${hidden ? "invisible" : ""}`}>
      <Link href="/" aria-label="Hale, home">
        <LogoMark size={40} />
      </Link>
      <h1 className="text-[clamp(1.875rem,1.5rem+1.5vw,2.5rem)] leading-[1.08] font-bold">{title}</h1>
      <p className="m-0 max-w-[36ch] text-[var(--ink-muted)]">{children}</p>
    </div>
  );
}

function Or() {
  return (
    <div className="flex items-center gap-3 text-[0.875rem] text-[var(--ink-muted)]" role="separator" aria-label="or">
      <span className="h-px flex-1 bg-[var(--hairline)]" />
      or
      <span className="h-px flex-1 bg-[var(--hairline)]" />
    </div>
  );
}

/**
 * Log in or sign up (DESIGN.md 8.3, v2). One email path for everyone: a code by email needs no password, and the
 * same step serves a new person and a returning one. A guest who adds an email keeps the same account and all their
 * chats (lib/auth/upgrade.ts); a guest whose email already has an account is simply logged in to it, with a clear
 * "welcome back" on the next step, and no warning box. The screen never scrolls: one heading, one sentence, one
 * primary button per step.
 */
export function LoginForm({ next: requested, linkError = false }: { next: string; linkError?: boolean }) {
  // Checked again here, so every redirect below (router.replace, the guest link, the email link) stays inside the app.
  const next = safeNext(requested);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [step, setStep] = useState<"start" | "code">("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [checked, setChecked] = useState(false);
  const [wasGuest, setWasGuest] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [welcomeBack, setWelcomeBack] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitted = useRef("");

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Someone already logged in has no need to be here. A guest is told their chats come with them.
  useEffect(() => {
    let cancelled = false;
    // The heading waits for this so a guest never sees it change. It never waits long: after 0.6 s it shows regardless.
    const fallback = setTimeout(() => setChecked(true), 600);
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session && data.session.user.is_anonymous !== true) {
        router.replace(next);
        return;
      }
      setWasGuest(data.session?.user.is_anonymous === true);
      setChecked(true);
    });
    return () => {
      cancelled = true;
      clearTimeout(fallback);
    };
  }, [supabase, router, next]);

  async function sendCode(event?: FormEvent, options: { forceLogin?: boolean; welcomeBack?: boolean } = {}) {
    event?.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await startEmail(supabase.auth, {
      email,
      isGuest: wasGuest,
      forceLogin: options.forceLogin,
      captcha: () => captchaToken("email"),
      redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
    });
    if (!result.ok && result.reason === "exists" && !options.forceLogin) {
      // A guest typed an email that already has an account: log them in to it. No warning box, no extra click.
      return sendCode(undefined, { forceLogin: true, welcomeBack: true });
    }
    setBusy(false);
    if (!result.ok) {
      setMessage(friendlyAuthMessage(result.error ?? {}, "email"));
      return;
    }
    setMode(result.mode);
    setWelcomeBack(options.welcomeBack ?? false);
    setStep("code");
    setCode("");
    submitted.current = "";
    setCooldown(60);
  }

  async function verifyCode(event?: FormEvent) {
    event?.preventDefault();
    if (busy || code.length < 6) return;
    setBusy(true);
    setMessage(null);
    const { error } = await verifyEmail(supabase.auth, { email, code, mode });
    if (error) {
      setBusy(false);
      setMessage(friendlyAuthMessage(error, "code"));
      // Clear the boxes and put the cursor back, so the next try is just typing.
      setCode("");
      submitted.current = "";
      setAttempt((value) => value + 1);
      return;
    }
    // Stay "busy" while the page changes, so there is no second tap.
    router.replace(next);
    router.refresh();
  }

  // The sixth digit logs in by itself (typed, pasted, or filled by the email app). The button stays for keyboards.
  useEffect(() => {
    if (!EMAIL_CODE || step !== "code" || code.length < 6 || busy || submitted.current === code) return;
    submitted.current = code;
    void verifyCode();
  });

  async function continueAsGuest() {
    setBusy(true);
    setMessage(null);
    let token: string | undefined;
    try {
      token = await captchaToken("guest");
    } catch (failure) {
      setBusy(false);
      setMessage(friendlyAuthMessage(failure as { code: string }, "guest"));
      return;
    }
    const { error } = await supabase.auth.signInAnonymously(token ? { options: { captchaToken: token } } : undefined);
    setBusy(false);
    if (error) {
      setMessage(friendlyAuthMessage(error, "guest"));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function continueWithGoogle() {
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setBusy(false);
      setMessage(friendlyAuthMessage(error, "email"));
    }
  }

  const errorBox = message ? (
    <p id="login-error" role="alert" className="res m-0 bg-[var(--alert-soft)] text-[var(--alert-text)]" style={{ padding: "10px 14px" }}>
      {message}
    </p>
  ) : null;

  // ---- Step 2: the code ------------------------------------------------------------------------------
  if (step === "code") {
    const inbox = mailProviderFor(email);
    return (
      <div className="grid w-full gap-4 [@media(min-height:720px)]:gap-5">
        <Head
          title={
            <>
              Check your <span className="hl">email</span>
            </>
          }
        >
          {EMAIL_CODE ? (
            <>
              We sent a 6-digit code to <b className="text-[var(--ink)]">{maskEmail(email)}</b>. Type it or paste it.
            </>
          ) : (
            <>
              We sent a sign-in link to <b className="text-[var(--ink)]">{maskEmail(email)}</b>. Open it on this device and you&apos;re in.
            </>
          )}
          {mode === "upgrade" ? " Your chats stay with you." : ""}
        </Head>

        {welcomeBack ? (
          <p className="banner m-0 text-[0.9375rem]" role="status">
            <b>Welcome back.</b> This email already has an account, so we&apos;re logging you in. Chats from this guest session won&apos;t move over.
          </p>
        ) : null}

        {EMAIL_CODE ? (
          <form onSubmit={verifyCode} className="grid gap-4">
            <OtpInput key={attempt} value={code} onChange={setCode} describedBy={message ? "login-error" : undefined} />
            {errorBox}
            <button className="btn btn-primary btn-lg w-full" type="submit" disabled={busy || code.length < 6}>
              {busy ? "Logging you in…" : mode === "upgrade" ? "Save my chats" : "Log in"}
            </button>
          </form>
        ) : (
          errorBox
        )}

        {inbox ? (
          <a className={`btn w-full ${EMAIL_CODE ? "" : "btn-primary btn-lg"}`} href={inbox.url} target="_blank" rel="noopener noreferrer">
            Open {inbox.name} ↗
          </a>
        ) : null}

        <div className="grid justify-items-center gap-1.5 text-[0.9375rem]">
          <button
            className="font-semibold underline disabled:opacity-60 disabled:no-underline"
            type="button"
            disabled={busy || cooldown > 0}
            onClick={() => sendCode(undefined, { forceLogin: mode === "login" && wasGuest, welcomeBack })}
          >
            {cooldown > 0 ? `Send a new ${EMAIL_CODE ? "code" : "link"} in ${cooldown}s` : `Send a new ${EMAIL_CODE ? "code" : "link"}`}
          </button>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              setStep("start");
              setCode("");
              setMessage(null);
              setWelcomeBack(false);
            }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  // ---- Step 1: the email ----------------------------------------------------------------------------
  return (
    <div className="grid w-full gap-4 [@media(min-height:720px)]:gap-5">
      <Head
        title={
          wasGuest ? (
            <>
              Save your <span className="hl">chats</span>
            </>
          ) : (
            <>
              Log in or <span className="hl">sign up</span>
            </>
          )
        }
        hidden={!checked}
      >
        {wasGuest ? "You're a guest right now. Add your email and your chats come with you. No password." : "No password. We email you a code and you're in."}
      </Head>

      {linkError ? (
        <p role="alert" className="res m-0 bg-[var(--alert-soft)] text-[var(--alert-text)]" style={{ padding: "10px 14px" }}>
          That sign-in link didn&apos;t work. It may have expired. Please try again.
        </p>
      ) : null}

      {GOOGLE_ENABLED ? (
        <>
          <button className="btn btn-lg w-full" type="button" disabled={busy} onClick={continueWithGoogle}>
            <GoogleIcon /> Continue with Google
          </button>
          <Or />
        </>
      ) : null}

      <form onSubmit={(event) => sendCode(event, { welcomeBack: false })} className="grid gap-3" noValidate>
        <div>
          <label className="field-label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            className="field"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={message ? "login-error" : undefined}
          />
        </div>
        {errorBox}
        <button className="btn btn-primary btn-lg w-full" type="submit" disabled={busy || !email.trim()}>
          {busy ? "Sending…" : "Continue with email"}
        </button>
      </form>

      {wasGuest ? (
        <Link href={next} className="mx-auto font-semibold underline">
          Keep chatting as a guest
        </Link>
      ) : (
        <>
          <Or />
          <div className="grid gap-1.5">
            <button className="btn w-full" type="button" disabled={busy} onClick={continueAsGuest}>
              Continue as a guest
            </button>
            <p className={small}>A few questions a day. Guest chats are removed after 30 days.</p>
          </div>
        </>
      )}

      <p className={small}>
        You&apos;ll accept the{" "}
        <Link href="/terms" target="_blank">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank">
          Privacy Notice
        </Link>{" "}
        before your first answer.
      </p>
    </div>
  );
}
