import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Публичная страница одна — витрина со входом (на неё же ведёт «/» без входа). */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${SITE_URL}/login`, changeFrequency: "monthly", priority: 1 }];
}
