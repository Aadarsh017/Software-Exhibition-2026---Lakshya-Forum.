import type { NextConfig } from "next";

// Content-Security-Policy (PLAN.md §8.10, security review 2026-10-20): scripts, styles, fonts and images only from this
// site and Cloudflare's person check; the browser may talk only to this site and the Supabase project (sign-in, data,
// the chat stream); no plugins, no framing of this site, forms post only here. 'unsafe-inline' stays for scripts and
// styles because the prerendered pages carry Next's inline bootstrap and two small static scripts; a nonce-based policy
// would make every page dynamic, including the offline emergency page. Production only: the dev server needs eval for
// fast refresh.
const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const supabaseHost = supabase.replace(/^https?:\/\//, "");
// Cloudflare Turnstile (lib/auth/captcha.ts) loads one script and shows its check in a frame from this address.
const TURNSTILE = "https://challenges.cloudflare.com";
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE}`,
  `frame-src ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${supabase ? ` ${supabase} wss://${supabaseHost}` : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const config: NextConfig = {
  // The shared safety code is plain ESM in the workspace, so let Next compile it with the app.
  transpilePackages: ["@hch/shared"],
  poweredByHeader: false,
  reactStrictMode: true,
  // Lets the dev server also be opened at 127.0.0.1 (a second browser identity with no cookies, for testing signed-out screens).
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // The microphone is only for this site (voice typing, off by default). No camera, no location.
          { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: CSP }] : []),
        ],
      },
      {
        // The service worker (DESIGN.md 7.8): always checked for a new version, and it may only talk to this site.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default config;
