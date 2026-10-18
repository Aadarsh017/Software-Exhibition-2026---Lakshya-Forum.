import { execFileSync } from "node:child_process";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const distDir = join(rootDir, "dist");

execFileSync(process.execPath, [join(rootDir, "tools", "generate-icons.mjs")], {
  cwd: rootDir,
  stdio: "inherit",
});

const assets = [
  { file: "index.html", minify: minifyHtml },
  { file: "dashboard.html", minify: minifyHtml },
  { file: "styles.css", minify: minifyCss },
  { file: "dashboard.css", minify: minifyCss },
  { file: "app.js", minify: minifyJavaScript },
  { file: "dashboard.js", minify: minifyJavaScript },
  { file: "service-worker.js", minify: minifyJavaScript },
  { file: "manifest.webmanifest", minify: minifyJson },
];

const staticFiles = ["icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const results = assets.map(({ file, minify }) => {
  const source = readFileSync(join(rootDir, file), "utf8");
  const output = minify(source);
  const outputPath = join(distDir, file);
  writeFileSync(outputPath, output);
  writeFileSync(`${outputPath}.gz`, gzipSync(output, { level: 9 }));
  writeFileSync(
    `${outputPath}.br`,
    brotliCompressSync(output, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11,
      },
    })
  );

  return {
    file,
    originalBytes: Buffer.byteLength(source),
    distBytes: Buffer.byteLength(output),
  };
});

staticFiles.forEach((file) => {
  const outputPath = join(distDir, file);
  mkdirSync(dirname(outputPath), { recursive: true });
  copyFileSync(join(rootDir, file), outputPath);
});

const originalBytes = sum(results.map((result) => result.originalBytes));
const distBytes = sum(results.map((result) => result.distBytes));

console.log(`Built dist in ${distDir}`);
console.log(`Raw source: ${formatBytes(originalBytes)}`);
console.log(`Raw dist:   ${formatBytes(distBytes)} (${formatChange(originalBytes, distBytes)})`);

function minifyHtml(source) {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s+\/>/g, "/>")
    .trim();
}

function minifyCss(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,>+~])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function minifyJavaScript(source) {
  const input = source.replace(/\r\n/g, "\n");
  let output = "";
  let index = 0;

  while (index < input.length) {
    const char = input[index];
    const next = input[index + 1];

    if (char === "'" || char === '"' || char === "`") {
      const copied = copyQuoted(input, index, char);
      output += copied.text;
      index = copied.nextIndex;
      continue;
    }

    if (char === "/" && next === "/") {
      index = skipLineComment(input, index + 2);
      continue;
    }

    if (char === "/" && next === "*") {
      index = skipBlockComment(input, index + 2);
      continue;
    }

    if (char === "/" && isRegexStart(output)) {
      const copied = copyRegex(input, index);
      output += copied.text;
      index = copied.nextIndex;
      continue;
    }

    if (/\s/.test(char)) {
      const nextIndex = skipWhitespace(input, index + 1);
      if (needsSpace(output.at(-1), input[nextIndex])) {
        output += " ";
      }
      index = nextIndex;
      continue;
    }

    output += char;
    index += 1;
  }

  return output.trim();
}

function copyQuoted(input, startIndex, quote) {
  let index = startIndex + 1;
  while (index < input.length) {
    if (input[index] === "\\") {
      index += 2;
      continue;
    }
    if (input[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }

  return { text: input.slice(startIndex, index), nextIndex: index };
}

function copyRegex(input, startIndex) {
  let index = startIndex + 1;
  let inClass = false;

  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === "[") {
      inClass = true;
    } else if (char === "]") {
      inClass = false;
    } else if (char === "/" && !inClass) {
      index += 1;
      while (/[a-z]/i.test(input[index] || "")) {
        index += 1;
      }
      break;
    }
    index += 1;
  }

  return { text: input.slice(startIndex, index), nextIndex: index };
}

function skipLineComment(input, index) {
  while (index < input.length && input[index] !== "\n") {
    index += 1;
  }
  return index;
}

function skipBlockComment(input, index) {
  while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
    index += 1;
  }
  return Math.min(index + 2, input.length);
}

function skipWhitespace(input, index) {
  while (index < input.length && /\s/.test(input[index])) {
    index += 1;
  }
  return index;
}

function needsSpace(previous, next) {
  if (!previous || !next) {
    return false;
  }

  if (isWordLike(previous) && isWordLike(next)) {
    return true;
  }

  return (previous === "+" && next === "+") || (previous === "-" && next === "-");
}

function isWordLike(char) {
  return /[A-Za-z0-9_$]/.test(char);
}

function isRegexStart(output) {
  const previous = output.trimEnd().at(-1);
  return !previous || "([{=,:;!&|?+-*~^<>".includes(previous);
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function formatBytes(bytes) {
  return `${bytes.toLocaleString()} B`;
}

function formatChange(before, after) {
  const change = ((before - after) / before) * 100;
  return `${change.toFixed(1)}% smaller`;
}

function minifyJson(source) {
  return JSON.stringify(JSON.parse(source));
}