import "server-only";
import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PersonRow } from "./admin-people";
import type { FeedbackRow } from "./admin-feedback";

/** Все люди и магазины для админки — один запрос на страницу (шапка и список). */
export const loadPeople = cache(async (db: SupabaseClient): Promise<PersonRow[]> => {
  const { data, error } = await db.rpc("admin_people");
  if (error) throw new Error("Не удалось загрузить магазины");
  return (data ?? []) as PersonRow[];
});

/** Заявки (последние 500) — для шапки (новые, «связаться») и страницы заявок. */
export const loadFeedback = cache(async (db: SupabaseClient): Promise<FeedbackRow[]> => {
  const { data, error } = await db.rpc("admin_feedback");
  if (error) throw new Error("Не удалось загрузить заявки");
  return (data ?? []) as FeedbackRow[];
});
