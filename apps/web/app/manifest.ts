import type { MetadataRoute } from "next";

// Makes the app installable (DESIGN.md 7.8). Served at /manifest.webmanifest and linked from every page.
// The icons are drawn from app/icon.svg by scripts/make-icons.mjs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "Hale",
    short_name: "Hale",
    description: "Hale: health, explained calmly. Sourced answers with a clear next step. Emergency numbers work offline.",
    start_url: "/app",
    // The whole site, so /emergency opens inside the installed app too.
    scope: "/",
    display: "standalone",
    theme_color: "#F7F3EB",
    background_color: "#F7F3EB",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Press and hold the icon: straight to the numbers.
    shortcuts: [{ name: "Emergency numbers", short_name: "Emergency", url: "/emergency" }],
  };
}
