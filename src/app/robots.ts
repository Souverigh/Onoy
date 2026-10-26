import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Открыты только витрина (/login), документы (/privacy, /terms) и картинки бренда. Всё остальное — кабинет
 * магазина и страницы клиентов по ссылке (/c/…) с долгами — поисковикам закрыто:
 * список разрешённого, а не запрещённого, чтобы новые разделы не утекали в поиск.
 * Карта сайта тоже в списке: под «Disallow: /» поисковик мог её не прочитать.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/login$", "/privacy$", "/terms$", "/opengraph-image", "/icon", "/icons/", "/apple-icon", "/manifest.webmanifest", "/sitemap.xml$"],
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
