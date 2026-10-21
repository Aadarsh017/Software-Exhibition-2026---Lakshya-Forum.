// Builds the sign-in emails (supabase/templates/*.html) from one base design, so they stay consistent.
//   node scripts/build-email-templates.mjs           write the files
//   node scripts/build-email-templates.mjs --check   fail if the files on disk are out of date
//
// Email clients are stricter than browsers: tables for layout, inline styles, no images, no web fonts,
// no scripts, no tracking. The look follows DESIGN.md (cream paper, ink outline, coral button) as far as
// email allows. The Supabase placeholders ({{ .Token }}, {{ .ConfirmationURL }}) are filled in by Supabase.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "supabase", "templates");

const INK = "#1A1C1E";
const PAPER = "#F7F3EB";
const CARD = "#FFFFFF";
const CORAL = "#FE976C";
const BLUSH = "#FFEAD8";
const MUTED = "#55524C";
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

// Each email says what the code is for. They all say how long it lasts: keep this in step with
// otp_expiry in supabase/config.toml (900 seconds = 15 minutes).
const templates = {
  magic_link: {
    title: "Your sign-in code",
    heading: "Your sign-in code",
    intro: "Enter this code to log in to Hale. It works for 15 minutes.",
    button: "Log in",
    preheader: "Your sign-in code is {{ .Token }}. It works for 15 minutes.",
  },
  confirmation: {
    title: "Your sign-in code",
    heading: "Welcome. Here is your code",
    intro: "Enter this code to finish creating your account. It works for 15 minutes.",
    button: "Finish signing up",
    preheader: "Your code is {{ .Token }}. It works for 15 minutes.",
  },
  email_change: {
    title: "Confirm your email",
    heading: "Confirm your email",
    intro: "Enter this code to add your email to your account, so you can keep your chats. It works for 15 minutes.",
    button: "Confirm my email",
    preheader: "Your confirmation code is {{ .Token }}. It works for 15 minutes.",
  },
};

function render(t) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${t.title}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .page { background: #141517 !important; }
    .card { background: #1F2124 !important; border-color: #CFCABF !important; }
    .ink { color: #F3EEE4 !important; }
    .muted { color: #B3AFA5 !important; }
    .code { background: #3A2A22 !important; border-color: #CFCABF !important; color: #F3EEE4 !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${t.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="page" style="background:${PAPER};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td class="ink" style="padding:0 0 16px;font-family:${SERIF};font-size:22px;font-weight:600;color:${INK};">hale</td>
        </tr>
        <tr>
          <td class="card" style="background:${CARD};border:2px solid ${INK};border-bottom-width:5px;border-radius:10px;padding:28px 24px;">
            <h1 class="ink" style="margin:0 0 12px;font-family:${SERIF};font-size:28px;line-height:1.2;font-weight:600;color:${INK};">${t.heading}</h1>
            <p class="ink" style="margin:0 0 20px;font-family:${SANS};font-size:17px;line-height:1.6;color:${INK};">${t.intro}</p>
            <div class="code" style="background:${BLUSH};border:2px solid ${INK};border-radius:6px;padding:16px 8px;text-align:center;font-family:${MONO};font-size:34px;line-height:1.2;letter-spacing:8px;font-weight:700;color:${INK};">{{ .Token }}</div>
            <p class="ink" style="margin:24px 0 12px;font-family:${SANS};font-size:16px;line-height:1.6;color:${INK};">Opened this on the device where you asked for the code? You can also use this button.</p>
            <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:${CORAL};color:${INK};border:2px solid ${INK};border-bottom-width:4px;border-radius:6px;padding:12px 22px;font-family:${SANS};font-size:16px;font-weight:700;text-decoration:none;">${t.button}</a>
            <p class="muted" style="margin:24px 0 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${MUTED};">Didn't ask for this? You can ignore this email. Nobody can log in to your account without the code.</p>
          </td>
        </tr>
        <tr>
          <td class="muted" style="padding:20px 4px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${MUTED};">Hale gives general health information, not medical advice. In an emergency, call 112.</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}

const check = process.argv.includes("--check");
mkdirSync(outDir, { recursive: true });
let stale = 0;
for (const [name, template] of Object.entries(templates)) {
  const path = join(outDir, `${name}.html`);
  const html = render(template);
  if (check) {
    if (!existsSync(path) || readFileSync(path, "utf8") !== html) {
      console.error(`out of date: supabase/templates/${name}.html (run: node scripts/build-email-templates.mjs)`);
      stale += 1;
    }
  } else {
    writeFileSync(path, html);
    console.log(`wrote supabase/templates/${name}.html (${html.length} bytes)`);
  }
}
if (check) process.exit(stale ? 1 : 0);
