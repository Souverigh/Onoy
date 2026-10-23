import "server-only";
import { revalidateTag, unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnonClient } from "./supabase/server";

/**
 * Кеш каталога клиентов (просьба пользователя 22.10.2026): каталог читается
 * из базы один раз и дальше раздаётся из кеша Next.js — без запросов к базе
 * на каждый заход клиента. Изменили товары — refreshCatalog сбрасывает кеш
 * этого каталога; на всякий случай кеш живёт не дольше часа.
 */
export const CATALOG_REVALIDATE = 3600;

export const catalogTag = (token: string) => `catalog:${token}`;

export type CatalogData = {
  shop_name: string;
  shop_phone: string;
  currency: string;
  products: { id: string; name: string; unit: string; price: string; photo?: string | null; category?: string | null }[];
  /** Категории с видимыми товарами (миграция 20261023100000); parent — у подкатегории. */
  categories?: { id: string; name: string; parent: string | null }[];
};

/** Каталог по ссылке: из кеша, а в базу — только если кеш пуст или сброшен. */
export function loadCatalog(token: string): Promise<CatalogData | null> {
  return unstable_cache(
    async () => {
      const { data, error } = await createAnonClient().rpc("get_catalog", { p_token: token });
      // Ошибку базы не кешируем: бросаем — следующий заход попробует снова.
      if (error) throw new Error(`get_catalog: ${error.message}`);
      return (data as CatalogData | null) ?? null;
    },
    ["catalog", token],
    { tags: [catalogTag(token)], revalidate: CATALOG_REVALIDATE },
  )();
}

/** Ссылка каталога со страницы клиента — не чаще раза в 10 минут на клиента. */
export function loadCatalogTokenByLink(clientToken: string): Promise<string | null> {
  return unstable_cache(
    async () => {
      const { data, error } = await createAnonClient().rpc("get_catalog_token_by_link", { p_token: clientToken });
      if (error) throw new Error(`get_catalog_token_by_link: ${error.message}`);
      return typeof data === "string" ? data : null;
    },
    ["catalog-by-link", clientToken],
    { revalidate: 600 },
  )();
}

/** Сбросить кеш каталога по известной ссылке (настройки каталога у владельца). */
export function refreshCatalogToken(token: string | null | undefined) {
  if (token) revalidateTag(catalogTag(token), { expire: 0 });
}

/**
 * Товары магазина изменились — сбросить кеш его каталога (если каталог
 * включён). Ошибка — только лог: кеш и так обновится не позже чем через час.
 */
export async function refreshCatalog(db: SupabaseClient, organizationId: string) {
  try {
    const { data, error } = await db.rpc("get_catalog_token_for_org", { p_org: organizationId });
    if (error) {
      console.error("refreshCatalog failed", { message: error.message });
      return;
    }
    refreshCatalogToken(typeof data === "string" ? data : null);
  } catch (error) {
    console.error("refreshCatalog failed", error);
  }
}
