import type { MetadataRoute } from "next";
import { BRAND_GREEN, SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/**
 * Установка Depter на телефон как приложения (кнопка — src/components/install-app.tsx).
 * Service worker нет намеренно: Chrome для установки его не требует, а кэш
 * страниц с долгами показал бы устаревшие суммы.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Depter - учёт долгов магазина",
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "ru",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f6f7f4",
    theme_color: BRAND_GREEN,
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
    // Долгое нажатие на значок — сразу в нужный раздел.
    shortcuts: [
      { name: "Новая продажа", short_name: "Продажа", url: "/money/new?type=sale" },
      { name: "Клиенты", url: "/customers" },
    ],
  };
}
