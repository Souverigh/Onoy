import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Открыта только витрина (/login) и картинки бренда. Всё остальное — кабинет
 * магазина и страницы клиентов по ссылке (/c/…) с долгами — поисковикам закрыто:
 * список разрешённого, а не запрещённого, чтобы новые разделы не утекали в поиск.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/$", "/login$", "/opengraph-image", "/icon", "/apple-icon", "/manifest.webmanifest"],
      disallow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
