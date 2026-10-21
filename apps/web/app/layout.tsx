import type { Metadata, Viewport } from "next";
import { Caveat, Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { FreshStart } from "@/components/pwa/fresh-start";
import { ServiceWorker } from "@/components/pwa/service-worker";
import { INSTALL_SCRIPT } from "@/lib/pwa/install";

// Self-hosted at build time by next/font: no request from a visitor's browser goes to Google (DESIGN.md 5.1).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], axes: ["opsz", "SOFT"], variable: "--font-fraunces", display: "swap" });
// The pen hand, for margin notes only (DESIGN.md 5.1, 8.3).
const caveat = Caveat({ subsets: ["latin"], variable: "--font-caveat", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
  title: {
    default: "Hale: health, explained calmly",
    template: "%s · Hale",
  },
  description:
    "Plain-language answers to health questions, checked against NIH and FDA sources, with a clear next step. Day or night.",
  applicationName: "Hale",
  // The installed app (DESIGN.md 7.8). The manifest is app/manifest.ts; this is the name under the icon on iPhone.
  appleWebApp: { capable: true, title: "Hale", statusBarStyle: "default" },
};

// No pinch or double-tap zoom, on the website and the installed app (founder, 2026-10-19: "block the browser zoom for
// the phone app"). People who need bigger text use Settings, Language and text, Text size (DESIGN.md 9), which scales
// every size in the app. maximumScale also stops iPhones zooming in when a text box is tapped.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F3EB" },
  ],
};

// Sets the text size before first paint so there is no flash (DESIGN.md 9). There is one look: light.
const TEXT_SIZE_SCRIPT = `(function(){try{var z=localStorage.getItem("hch-text-size");if(z==="s"||z==="l"||z==="xl")document.documentElement.dataset.textSize=z}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${caveat.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: TEXT_SIZE_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: INSTALL_SCRIPT }} />
      </head>
      <body>
        {/* Hand-drawn wobble for the doodles, defined once (DESIGN.md 6.6) */}
        <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
          <filter id="rough" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <ServiceWorker />
        <FreshStart />
      </body>
    </html>
  );
}
