"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, which keeps /emergency working offline (DESIGN.md 7.8). Production builds only. The dev
 * server removes any earlier registration and its saved copy, so a production test on localhost never serves old
 * pages to development.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((registration) => void registration.unregister()));
      if ("caches" in window) void caches.keys().then((names) => names.filter((name) => name.startsWith("hch-")).forEach((name) => void caches.delete(name)));
      return;
    }
    // After the page has loaded, so it never competes with the first paint.
    const register = () => void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
