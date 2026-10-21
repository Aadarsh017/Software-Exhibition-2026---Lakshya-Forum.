// The installable app and the offline emergency page (DESIGN.md 7.8). The real public/sw.js runs here against a
// fake site and a fake cache, so we can see exactly what it stores and what it serves with the network gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { needsShareHint } from "../lib/pwa/install.ts";
import manifest from "../app/manifest.ts";

const ORIGIN = "https://healthchat.example";
const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

const EMERGENCY_HTML = `<!DOCTYPE html><html><head>
<link rel="preload" href="/_next/static/media/inter.p.woff2" as="font" crossorigin="" type="font/woff2"/>
<link rel="stylesheet" href="/_next/static/chunks/app.css" data-precedence="next"/>
<link rel="icon" href="/icon.svg?icon.abc.svg" sizes="any" type="image/svg+xml"/>
<link rel="manifest" href="/manifest.webmanifest"/>
<script src="/_next/static/chunks/main.js" async=""></script>
<script src="https://elsewhere.example/_next/static/chunks/theirs.js"></script>
</head><body><a href="tel:112">Call 112</a><a href="/">Back</a><a href="/app">App</a>
<script>self.__next_f.push([1,"2:I[123,[\\"static/chunks/link.js\\"],\\"default\\"]"])</script></body></html>`;
const CSS = `@font-face{src:url(../media/fraunces.woff2) format("woff2")}.x{background:url(data:image/png;base64,AAAA)}`;
const PUBLIC = {
  "/emergency": [EMERGENCY_HTML, "text/html"],
  "/_next/static/media/inter.p.woff2": ["font", "font/woff2"],
  "/_next/static/media/fraunces.woff2": ["font", "font/woff2"],
  "/_next/static/chunks/app.css": [CSS, "text/css"],
  "/_next/static/chunks/main.js": ["main", "text/javascript"],
  "/_next/static/chunks/link.js": ["link", "text/javascript"],
  "/icon.svg": ["<svg/>", "image/svg+xml"],
};

function basic(body, status, type) {
  const response = new Response(body, { status, headers: { "Content-Type": type } });
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

/** A cache store that remembers every URL it was asked to keep. */
function fakeCaches() {
  const stores = new Map();
  const key = (request) => new URL(typeof request === "string" ? request : request.url, ORIGIN).href;
  const open = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async put(request, response) {
        store.set(key(request), response.clone());
      },
      async match(request) {
        return store.get(key(request))?.clone();
      },
      async keys() {
        return [...store.keys()].map((url) => ({ url }));
      },
    };
  };
  return {
    stores,
    async keys() {
      return [...stores.keys()];
    },
    async open(name) {
      return open(name);
    },
    async delete(name) {
      return stores.delete(name);
    },
    storedUrls() {
      return [...stores.values()].flatMap((store) => [...store.keys()]);
    },
  };
}

function worker() {
  const listeners = {};
  const caches = fakeCaches();
  const site = { online: true, requests: [] };
  const fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    site.requests.push({ url: url.href, credentials: init.credentials });
    if (!site.online) throw new TypeError("Failed to fetch");
    if (url.origin !== ORIGIN) return basic("elsewhere", 200, "text/plain");
    const hit = PUBLIC[url.pathname];
    if (hit) return basic(hit[0], 200, hit[1]);
    if (url.pathname.startsWith("/app")) return basic("<p>Your private chat</p>", 200, "text/html");
    return basic("not found", 404, "text/html");
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (type, listener) => (listeners[type] = listener),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const context = vm.createContext({ self, caches, fetch, Response, URL, Error, TypeError, Promise, String, Map, Set, console });
  vm.runInContext(source, context);

  async function dispatch(type, fields = {}) {
    const waits = [];
    let responded = null;
    const event = { ...fields, waitUntil: (promise) => waits.push(promise), respondWith: (promise) => (responded = Promise.resolve(promise)) };
    listeners[type](event);
    const response = responded ? await responded : null;
    await Promise.all(waits);
    return response;
  }
  const request = (path, mode = "cors", method = "GET") => ({ url: new URL(path, ORIGIN).href, mode, method });
  const go = (path, mode, method) => dispatch("fetch", { request: request(path, mode, method) });
  return { context, caches, site, dispatch, go };
}

test("pwa: only GET requests to this site are handled, and only public files may be stored", () => {
  const { context } = worker();
  const route = (method, url, mode) => context.routeFor(method, new URL(url, ORIGIN), mode);
  assert.equal(route("GET", "/emergency", "navigate"), "emergency");
  assert.equal(route("GET", "/emergency/", "navigate"), "emergency");
  assert.equal(route("GET", "/app", "navigate"), "page", "network, with the offline screen if it fails");
  assert.equal(route("GET", "/app/settings", "navigate"), "page");
  assert.equal(route("GET", "/_next/static/chunks/main.js", "no-cors"), "stored");
  assert.equal(route("GET", "/emergency?_rsc=1", "cors"), null, "the page's data request goes to the network");
  assert.equal(route("GET", "https://abcd.supabase.co/rest/v1/conversations", "cors"), null);
  assert.equal(route("GET", "https://abcd.supabase.co/functions/v1/chat", "navigate"), null);
  assert.equal(route("POST", "/app", "navigate"), null);
  assert.equal(route("GET", "/auth/callback?code=x", "cors"), null);
  for (const path of ["/app", "/app/diary", "/app/summaries/1", "/login", "/auth/callback", "/api/anything", "/", "/manifest.webmanifest", "/sw.js"]) {
    assert.equal(context.mayStore(path), false, path);
  }
});

test("pwa: the files /emergency needs are found in its HTML and stylesheet", () => {
  const { context } = worker();
  const fromHtml = Array.from(context.assetsIn(EMERGENCY_HTML, `${ORIGIN}/emergency`)).map((url) => url.replace(ORIGIN, "")).sort();
  assert.deepEqual(fromHtml, [
    "/_next/static/chunks/app.css",
    "/_next/static/chunks/link.js",
    "/_next/static/chunks/main.js",
    "/_next/static/media/inter.p.woff2",
    "/icon.svg?icon.abc.svg",
  ]);
  const fromCss = Array.from(context.assetsIn(CSS, `${ORIGIN}/_next/static/chunks/app.css`));
  assert.deepEqual(fromCss, [`${ORIGIN}/_next/static/media/fraunces.woff2`]);
});

test("pwa: install saves /emergency and its files, without cookies, and nothing else", async () => {
  const { dispatch, caches, site } = worker();
  await dispatch("install");
  const stored = caches.storedUrls().map((url) => url.replace(ORIGIN, "")).sort();
  assert.deepEqual(stored, [
    "/_next/static/chunks/app.css",
    "/_next/static/chunks/link.js",
    "/_next/static/chunks/main.js",
    "/_next/static/media/fraunces.woff2",
    "/_next/static/media/inter.p.woff2",
    "/emergency",
    "/icon.svg?icon.abc.svg",
  ]);
  assert.ok(site.requests.every((request) => request.credentials === "omit"), "no cookies on anything it saves");
  assert.ok(site.requests.every((request) => request.url.startsWith(ORIGIN)), "never fetches another site");
});

test("pwa: with the network gone, /emergency still opens and other pages get the offline screen", async () => {
  const { dispatch, go, site } = worker();
  await dispatch("install");
  site.online = false;

  const page = await go("/emergency", "navigate");
  assert.equal(page.status, 200);
  assert.match(await page.text(), /tel:112/);
  const css = await go("/_next/static/chunks/app.css", "no-cors");
  assert.equal(await css.text(), CSS);
  const font = await go("/_next/static/media/fraunces.woff2", "cors");
  assert.equal(font.status, 200);

  const offline = await go("/app", "navigate");
  assert.equal(offline.status, 503);
  const text = await offline.text();
  assert.match(text, /You're offline/);
  assert.match(text, /href="\/emergency"/);
  assert.match(text, /tel:112/);
});

test("pwa: using the app online stores nothing private", async () => {
  const { dispatch, go, caches } = worker();
  await dispatch("install");
  const before = caches.storedUrls().sort();

  const chat = await go("/app", "navigate");
  assert.equal(await chat.text(), "<p>Your private chat</p>");
  await go("/app/settings", "navigate");
  assert.equal(await go("https://abcd.supabase.co/functions/v1/chat", "cors", "POST"), null, "not touched at all");
  assert.equal(await go("https://abcd.supabase.co/rest/v1/profiles", "cors"), null);
  await go("/emergency", "navigate");

  assert.deepEqual(caches.storedUrls().sort(), before, "the same public files, nothing added");
  for (const url of caches.storedUrls()) {
    assert.equal(new URL(url).origin, ORIGIN, url);
    assert.doesNotMatch(new URL(url).pathname, /^\/(app|login|auth|api)(\/|$)/, url);
  }
});

test("pwa: a changed /emergency is saved again, and only the two newest copies are kept", async () => {
  const { dispatch, go, caches } = worker();
  await dispatch("install");
  await go("/emergency", "navigate");
  assert.equal(caches.stores.size, 1, "unchanged page: no new copy");

  const original = PUBLIC["/emergency"];
  try {
    for (const version of ["v2", "v3", "v4"]) {
      PUBLIC["/emergency"] = [EMERGENCY_HTML.replace("Call 112", `Call 112 ${version}`), "text/html"];
      await new Promise((resolve) => setTimeout(resolve, 2)); // a new timestamp for the new copy
      await go("/emergency", "navigate");
    }
  } finally {
    PUBLIC["/emergency"] = original;
  }
  assert.equal(caches.stores.size, 2);
  const page = await go("/emergency", "navigate");
  assert.match(await page.text(), /Call 112 v4/);
});

test("pwa: the manifest makes the app installable from the Home Screen", () => {
  const m = manifest();
  assert.equal(m.name, "Hale");
  assert.equal(m.short_name, "Hale");
  assert.equal(m.start_url, "/app");
  assert.equal(m.display, "standalone");
  assert.equal(m.theme_color, "#F7F3EB");
  assert.equal(m.background_color, "#F7F3EB");
  const sizes = m.icons.map((icon) => `${icon.sizes} ${icon.purpose}`);
  assert.deepEqual(sizes, ["192x192 any", "512x512 any", "512x512 maskable"]);
});

test("pwa: the Add to Home Screen hint is for iPhone and iPad only, and not inside the installed app", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";
  const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
  assert.equal(needsShareHint({ userAgent: iphone, platform: "iPhone", maxTouchPoints: 5 }, false), true);
  assert.equal(needsShareHint({ userAgent: mac, platform: "MacIntel", maxTouchPoints: 5 }, false), true, "iPad in desktop mode");
  assert.equal(needsShareHint({ userAgent: mac, platform: "MacIntel", maxTouchPoints: 0 }, false), false, "a Mac");
  assert.equal(needsShareHint({ userAgent: android, platform: "Linux armv8l", maxTouchPoints: 5 }, false), false);
  assert.equal(needsShareHint({ userAgent: iphone, platform: "iPhone", maxTouchPoints: 5, standalone: true }, false), false);
  assert.equal(needsShareHint({ userAgent: iphone, platform: "iPhone", maxTouchPoints: 5 }, true), false);
});
