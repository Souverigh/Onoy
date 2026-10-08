/** Адрес сайта для поисковиков и превью (robots, sitemap, og:url). С www: depter.kg перенаправляет туда (Vercel). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.depter.kg").replace(/\/$/, "");

export const SITE_NAME = "Depter";
export const SITE_TITLE = "Depter - учёт долгов магазина онлайн";
export const SITE_DESCRIPTION =
  "Электронная тетрадь долгов для магазина: долги клиентов и поставщиков, накладные в WhatsApp, " +
  "перенос старой тетради по фото, склад и отчёты. Работает в браузере на телефоне и компьютере.";
