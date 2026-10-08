/** Адрес сайта для поисковиков и превью (robots, sitemap, og:url). С www: depter.kg перенаправляет туда (Vercel). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.depter.kg").replace(/\/$/, "");

export const SITE_NAME = "Depter";
export const BRAND_GREEN = "#245d4c";
export const BRAND_ACCENT = "#dcf2a5";
export const SITE_TITLE = "Depter - учёт долгов магазина онлайн";
export const SITE_DESCRIPTION =
  "Электронная тетрадь долгов для магазина: долги клиентов и поставщиков, накладные в WhatsApp, " +
  "перенос старой тетради по фото, склад и отчёты. Работает в браузере на телефоне и компьютере.";

/**
 * Общие поля превью. openGraph страницы заменяет родительский целиком, а не
 * дополняет, — поэтому страница со своим openGraph разворачивает их у себя.
 */
export const OPEN_GRAPH_BASE = {
  type: "website" as const,
  siteName: SITE_NAME,
  locale: "ru_RU",
  images: { url: "/opengraph-image", width: 1200, height: 630, alt: SITE_TITLE },
};
