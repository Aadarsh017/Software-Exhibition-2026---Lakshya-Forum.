// Hale service worker (DESIGN.md 7.8, PLAN.md §12). Registered in production builds only.
//
// One job: the emergency numbers page opens with no signal. On install it saves /emergency and the build files
// that page names (styles, fonts, scripts), and serves that copy when the network fails. It never stores anything
// private: the only paths it may keep are in mayStore(), so no /app page, no API reply and no Supabase call
// (other sites are never touched at all). Every other page goes to the network as usual; if a page cannot load,
// a plain offline screen points to the emergency numbers.

const PREFIX = "hch-emergency-";
const EMERGENCY = "/emergency";

/** The only things this worker may ever store: the emergency page and public build files. */
function mayStore(path) {
  return (
    path === EMERGENCY ||
    path.startsWith("/_next/static/") ||
    path.startsWith("/icons/") ||
    path === "/icon.svg" ||
    path === "/apple-icon.png"
  );
}

/** What to do with a request: "emergency" (saved copy), "stored" (saved build file, else network), "page" (network, else offline screen) or null (leave it alone). */
function routeFor(method, url, mode) {
  if (method !== "GET" || url.origin !== self.location.origin) return null;
  if (mode === "navigate") return url.pathname.replace(/\/+$/, "") === EMERGENCY ? "emergency" : "page";
  if (url.pathname !== EMERGENCY && mayStore(url.pathname)) return "stored";
  return null;
}

/** The build files a page or stylesheet names, as absolute URLs on this site, keeping only what mayStore() allows. */
function assetsIn(text, base) {
  const refs = [
    // Script and style tags, and the chunk names inside Next's inline data (never part of another site's address).
    ...text.matchAll(/(?<![\w.:\/-])(?:\/_next\/)?static\/(?:chunks|media|css)\/[\w.~\/-]+/g),
    // Root-relative href and src (icons). The page's own links ("/") are dropped by mayStore().
    ...text.matchAll(/(?:href|src)="(\/[^"\s]*)"/g),
    // Fonts named by a stylesheet, usually relative to it.
    ...text.matchAll(/url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g),
  ].map((match) => match[1] ?? match[0]);
  const found = new Set();
  for (const ref of refs) {
    if (ref.startsWith("data:")) continue;
    const url = new URL(ref.startsWith("static/") ? `/_next/${ref}` : ref, base);
    if (url.origin === new URL(base).origin && url.pathname !== EMERGENCY && mayStore(url.pathname)) found.add(url.href);
  }
  return [...found];
}

/** Saved copies, newest first. Each save is its own cache; the newest two are kept, so a page being shown never loses its files. */
async function savedCaches() {
  return (await caches.keys()).filter((name) => name.startsWith(PREFIX)).sort().reverse();
}

async function savedPage() {
  for (const name of await savedCaches()) {
    const hit = await (await caches.open(name)).match(EMERGENCY, { ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

async function mustFetch(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok || response.type !== "basic") throw new Error(`${url}: ${response.status}`);
  return response;
}

/** Fetch /emergency and everything it needs, and keep them together. Skips the work when the page has not changed. */
async function saveEmergency() {
  // No cookies: the saved page is exactly what anybody would get.
  const page = await fetch(EMERGENCY, { credentials: "omit", cache: "no-cache" });
  if (!page.ok || page.redirected || page.type !== "basic") throw new Error(`${EMERGENCY}: ${page.status}`);
  const html = await page.clone().text();
  const previous = await savedPage();
  if (previous && (await previous.text()) === html) return;

  const files = new Map();
  for (const url of assetsIn(html, new URL(EMERGENCY, self.location.origin).href)) files.set(url, await mustFetch(url));
  for (const [url, response] of [...files]) {
    if (!new URL(url).pathname.endsWith(".css")) continue;
    for (const font of assetsIn(await response.clone().text(), url)) if (!files.has(font)) files.set(font, await mustFetch(font));
  }

  const name = PREFIX + String(Date.now()).padStart(15, "0");
  const cache = await caches.open(name);
  try {
    for (const [url, response] of files) await cache.put(url, response);
    await cache.put(EMERGENCY, page);
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
  const [, , ...old] = await savedCaches();
  await Promise.all(old.map((stale) => caches.delete(stale)));
}

async function emergencyPage(request) {
  const saved = await savedPage();
  if (saved) return saved;
  try {
    return await fetch(request);
  } catch {
    return offlineScreen();
  }
}

async function storedOrNetwork(request) {
  for (const name of await savedCaches()) {
    const hit = await (await caches.open(name)).match(request, { ignoreVary: true });
    if (hit) return hit;
  }
  return fetch(request);
}

async function pageOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineScreen();
  }
}

// Built here, so it needs nothing saved. Same colours as the app (DESIGN.md 3).
const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#F7F3EB"><title>You're offline · Hale</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;background:#F7F3EB;color:#1A1C1E;font:17px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{width:100%;max-width:420px;display:grid;gap:14px}h1{margin:0;font:700 1.75rem/1.15 Georgia,serif}p{margin:0}
.btn{display:flex;align-items:center;justify-content:center;min-height:52px;border:2px solid #1A1C1E;border-radius:10px;box-shadow:3px 3px 0 #1A1C1E;background:#FFFFFF;color:#1A1C1E;font-weight:700;text-decoration:none}
.alert{color:#B42318;border-color:#B42318;box-shadow:3px 3px 0 #B42318}.small{font-size:.9375rem;color:#55524C}.small a{color:#B42318;font-weight:700}
</style></head><body><main id="main"><h1>You're offline</h1><p>Answers need the internet. The emergency numbers work without it.</p>
<a class="btn" href="">Try again</a><a class="btn alert" href="/emergency">Emergency numbers</a>
<p class="small">In an emergency, call <a href="tel:112">112</a>.</p></main></body></html>`;

function offlineScreen() {
  return new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

self.addEventListener("install", (event) => {
  // If the page cannot be saved, the install fails and the browser tries again on the next visit.
  event.waitUntil(saveEmergency().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  // Drop caches from any other version of this worker, then look after open pages straight away.
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("hch-") && !name.startsWith(PREFIX)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const route = routeFor(request.method, new URL(request.url), request.mode);
  if (route === "emergency") {
    // Shown at once from the saved copy, which is refreshed in the background for next time.
    event.respondWith(emergencyPage(request));
    event.waitUntil(saveEmergency().catch(() => undefined));
  } else if (route === "stored") event.respondWith(storedOrNetwork(request));
  else if (route === "page") event.respondWith(pageOrOffline(request));
});
