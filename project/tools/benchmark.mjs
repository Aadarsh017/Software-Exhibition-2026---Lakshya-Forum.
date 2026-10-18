import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");
const assetFiles = [
  "index.html",
  "dashboard.html",
  "styles.css",
  "dashboard.css",
  "app.js",
  "dashboard.js",
  "service-worker.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

const buildStart = performance.now();
execFileSync(process.execPath, [join(rootDir, "tools", "build.mjs")], {
  cwd: rootDir,
  stdio: "pipe",
});
const buildMs = performance.now() - buildStart;

const original = collectSizes(rootDir);
const compressed = collectSizes(distDir);
const report = createReport(original, compressed, buildMs);

writeFileSync(join(rootDir, "BENCHMARK.md"), report);
console.log(report);

function collectSizes(baseDir) {
  const files = assetFiles.map((file) => {
    const content = readFileSync(join(baseDir, file));
    return {
      file,
      raw: content.length,
      gzip: gzipSync(content, { level: 9 }).length,
      brotli: brotliCompressSync(content, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
        },
      }).length,
    };
  });

  return {
    files,
    totals: {
      raw: sum(files.map((file) => file.raw)),
      gzip: sum(files.map((file) => file.gzip)),
      brotli: sum(files.map((file) => file.brotli)),
    },
  };
}

function createReport(original, compressed, buildMs) {
  const lines = [
    "# Benchmark Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Build time: ${buildMs.toFixed(1)} ms`,
    "",
    "## Totals",
    "",
    "| Version | Raw | Gzip | Brotli |",
    "|---|---:|---:|---:|",
    `| Source | ${formatBytes(original.totals.raw)} | ${formatBytes(original.totals.gzip)} | ${formatBytes(original.totals.brotli)} |`,
    `| Dist | ${formatBytes(compressed.totals.raw)} | ${formatBytes(compressed.totals.gzip)} | ${formatBytes(compressed.totals.brotli)} |`,
    `| Reduction | ${formatPercent(original.totals.raw, compressed.totals.raw)} | ${formatPercent(original.totals.gzip, compressed.totals.gzip)} | ${formatPercent(original.totals.brotli, compressed.totals.brotli)} |`,
    "",
    "## Files",
    "",
    "| File | Source Raw | Dist Raw | Raw Reduction | Dist Gzip | Dist Brotli |",
    "|---|---:|---:|---:|---:|---:|",
  ];

  compressed.files.forEach((distFile) => {
    const sourceFile = original.files.find((file) => file.file === distFile.file);
    lines.push(
      `| ${distFile.file} | ${formatBytes(sourceFile.raw)} | ${formatBytes(distFile.raw)} | ${formatPercent(sourceFile.raw, distFile.raw)} | ${formatBytes(distFile.gzip)} | ${formatBytes(distFile.brotli)} |`
    );
  });

  lines.push(
    "",
    "## Notes",
    "",
    "- `npm run build` writes compressed production files to `dist/`.",
    "- Each `dist` asset also gets `.gz` and `.br` versions for gzip and Brotli serving.",
    "- JavaScript and CSS assets are compacted and pre-compressed with gzip/Brotli for optimal performance.",
    ""
  );

  return lines.join("\n");
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatPercent(before, after) {
  return `${(((before - after) / before) * 100).toFixed(1)}%`;
}