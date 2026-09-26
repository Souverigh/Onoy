import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const port = 3041;
const proc = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
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
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
proc.stdout.on("data", (d) => {
  log += d;
  process.stdout.write(d);
});
proc.stderr.on("data", (d) => {
  log += d;
  process.stdout.write(d);
});
try {
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/login`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "Server did not start: " + log);
  for (const path of [
    "/",
    "/customers",
    "/products/new",
    "/money",
    "/money/new?type=sale",
    "/settings",
    "/documents",
    "/onboarding",
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
    });
    assert.equal(r.status, 307, path);
    assert.equal(r.headers.get("location"), "/login", path);
    console.log("PASS protected", path);
  }
  const preview = await fetch(`http://127.0.0.1:${port}/preview`);
  assert.equal(preview.status, 404);
  console.log("PASS production preview disabled even with flag");
  const login = await fetch(`http://127.0.0.1:${port}/login`, {
    signal: AbortSignal.timeout(2000),
  });
  const html = await login.text();
  assert.ok(html.includes("Рады вас видеть"));
  assert.ok(html.includes("Приложение подготовлено"));
  assert.equal(login.headers.get("x-robots-tag"), "noindex, nofollow");
  console.log("PASS setup screen and noindex");
} finally {
  proc.kill("SIGTERM");
}
