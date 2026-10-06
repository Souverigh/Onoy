import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Версия в Настройках (задача 36): из package.json, плюс коммит и дата сборки.
function appVersion() {
  const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
  let commit = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "";
  if (!commit)
    try {
      commit = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      commit = "";
    }
  const date = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date());
  return `${version.replace(/\.0$/, "")} · сборка ${date}${commit ? ` (${commit})` : ""}`;
}

const config: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_VERSION: appVersion() },
  experimental: {
    serverActions: {
      // Фото ужимаются в браузере (src/lib/shrink-image.ts) до ~0.5 МБ; запас —
      // на случай, когда браузер не смог их ужать (HEIC и т.п.). Выше 4.5 МБ
      // тело запроса всё равно не пропустит Vercel.
      bodySizeLimit: "4mb",
    },
  },
  // Товары живут в «Складе» (остатки, импорт, движение); старые адреса
  // справочника /products ведут туда же.
  async redirects() {
    return [
      { source: "/products", destination: "/stock", permanent: false },
      { source: "/products/:id", destination: "/stock/:id", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};
export default config;
