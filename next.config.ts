import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
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
