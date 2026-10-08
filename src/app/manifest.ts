import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

/** Значок «на экран Домой» на телефоне продавца. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Depter - учёт долгов магазина",
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    lang: "ru",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f4",
    theme_color: "#245d4c",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
