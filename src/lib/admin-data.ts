import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonRow } from "./admin-people";

/** Все люди и магазины для админки — один запрос на страницу (шапка и список). */
export const loadPeople = cache(async (db: SupabaseClient): Promise<PersonRow[]> => {
  const { data, error } = await db.rpc("admin_people");
  if (error) throw new Error("Не удалось загрузить магазины");
  return (data ?? []) as PersonRow[];
});
