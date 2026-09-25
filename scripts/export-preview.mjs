import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
const port = 3042;
const proc = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "dev",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      ONGOY_PREVIEW: "1",
    },
    stdio: "ignore",
  },
);
try {
  let html = "";
  for (let i = 0; i < 150; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/preview`);
      if (response.ok) {
        html = await response.text();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!html.includes("Сначала фото")) throw Error("Preview did not render");
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<link\b[^>]*>/gi, "")
    .replace(
      /<a\b[^>]*href="[^"]*"[^>]*>/gi,
      '<a href="#" onclick="return false">',
    )
    .replace(
      "</head>",
      `<style>${readFileSync("src/app/globals.css", "utf8")}</style></head>`,
    );
  writeFileSync("docs/preview.html", html);
  console.log("Exported actual rendered dashboard, static preview only");
} finally {
  proc.kill("SIGTERM");
}
