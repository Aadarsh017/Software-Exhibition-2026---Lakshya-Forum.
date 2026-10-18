import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { extname, join, normalize, resolve, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  searchMedlinePlus,
  searchOpenFdaDrugs,
  checkEmergency,
  generateCarePlan,
  consultRiverAssistant,
  chatWithHealthAssistant,
} from "./medical-api.mjs";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const serveDir = resolve(rootDir, process.argv[2] || ".");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const isDistServe = serveDir === resolve(rootDir, "dist");

const mimeTypes = {
  ".br": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  response.end(JSON.stringify(data));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  // Handle CORS Preflight
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    response.end();
    return;
  }

  // Handle Real Medical Knowledge API Routes
  if (pathname.startsWith("/api/")) {
    try {
      if (pathname === "/api/status" && request.method === "GET") {
        sendJson(response, 200, {
          status: "online",
          version: "2.1.0",
          llm: {
            provider: "River AI",
            model: process.env.RIVER_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash",
            connected: Boolean(process.env.RIVER_API_KEY),
          },
          liveDatabases: [
            {
              name: "NIH MedlinePlus",
              status: "connected",
              publisher: "U.S. National Library of Medicine",
              url: "https://medlineplus.gov",
            },
            {
              name: "OpenFDA",
              status: "connected",
              publisher: "U.S. Food and Drug Administration",
              url: "https://open.fda.gov",
            },
          ],
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (pathname === "/api/chat" && request.method === "POST") {
        const body = await parseJsonBody(request);
        const message = body.message || body.text || "";
        const history = body.history || [];

        const result = await chatWithHealthAssistant({ message, history });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/chat/assistant" && request.method === "POST") {
        const body = await parseJsonBody(request);
        const message = body.message || body.text || "";
        const sessionHistory = body.sessionHistory || [];
        const carePlanContext = body.carePlanContext || null;

        const reply = await consultRiverAssistant({ message, sessionHistory, carePlanContext });
        sendJson(response, 200, {
          reply,
          model: process.env.RIVER_MODEL || "deepseek-ai/DeepSeek-V4.1-Flash",
          provider: "River AI",
        });
        return;
      }

      if (pathname === "/api/medical/search" && request.method === "GET") {
        const query = requestUrl.searchParams.get("q") || "";
        const results = await searchMedlinePlus(query);
        sendJson(response, 200, { query, results });
        return;
      }

      if (pathname === "/api/medical/drugs" && request.method === "GET") {
        const query = requestUrl.searchParams.get("q") || "";
        const drugs = await searchOpenFdaDrugs(query);
        sendJson(response, 200, { query, drugs });
        return;
      }

      if (pathname === "/api/medical/triage" && request.method === "POST") {
        const body = await parseJsonBody(request);
        const text = body.message || body.text || "";
        const triage = checkEmergency(text);
        sendJson(response, 200, triage);
        return;
      }

      if (pathname === "/api/medical/care-plan" && request.method === "POST") {
        const body = await parseJsonBody(request);
        const topicName = body.topicName || body.topic || "Health Concern";
        const answers = body.answers || {};
        const userMessage = body.userMessage || "";

        const plan = await generateCarePlan({ topicName, answers, userMessage });
        sendJson(response, 200, plan);
        return;
      }

      sendJson(response, 404, { error: "API route not found" });
      return;
    } catch (apiError) {
      console.error("API error:", apiError);
      sendJson(response, 500, { error: "Internal medical API error", message: apiError.message });
      return;
    }
  }

  // Handle Static File Serving
  const safePath = normalize(pathname).replace(/^([/\\])+/, "");
  let filePath = resolve(serveDir, safePath || "index.html");

  if (!filePath.startsWith(`${serveDir}${sep}`) && filePath !== serveDir) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    filePath = join(serveDir, "index.html");
  }

  const encoded = getEncodedAsset(request, filePath);

  response.setHeader("Cache-Control", getCacheControl(filePath));
  response.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream");

  if (encoded.contentEncoding) {
    response.setHeader("Content-Encoding", encoded.contentEncoding);
    response.setHeader("Vary", "Accept-Encoding");
  }

  createReadStream(encoded.filePath).pipe(response);
});

server.listen(port, host, () => {
  console.log(`Serving ${serveDir}`);
  console.log(`Open http://localhost:${port}/`);
  getLanUrls(port).forEach((url) => {
    console.log(`Phone/LAN: ${url}`);
  });
});

function getLanUrls(serverPort) {
  return Object.values(networkInterfaces())
    .flat()
    .filter((networkInterface) => {
      return networkInterface && networkInterface.family === "IPv4" && !networkInterface.internal;
    })
    .map((networkInterface) => `http://${networkInterface.address}:${serverPort}/`);
}

function getEncodedAsset(request, filePath) {
  if (!isDistServe) {
    return { filePath };
  }

  const acceptedEncodings = request.headers["accept-encoding"] || "";
  const brotliPath = `${filePath}.br`;
  const gzipPath = `${filePath}.gz`;

  if (acceptedEncodings.includes("br") && existsSync(brotliPath)) {
    return { filePath: brotliPath, contentEncoding: "br" };
  }

  if (acceptedEncodings.includes("gzip") && existsSync(gzipPath)) {
    return { filePath: gzipPath, contentEncoding: "gzip" };
  }

  return { filePath };
}

function getCacheControl(filePath) {
  const isHtml = extname(filePath) === ".html";
  const isServiceWorker = filePath.endsWith("service-worker.js");

  if (!isDistServe || isHtml || isServiceWorker) {
    return "no-cache";
  }

  return "public, max-age=3600";
}