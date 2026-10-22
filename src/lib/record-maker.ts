import type { SupabaseClient } from "@supabase/supabase-js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Запись взамен отменённой («Исправить», «Открыть заново»): продавец — как у
 * отменённой, а не тот, кто нажал «Записать» (миграция record_maker.sql).
 * Поля формы: corrected_from — отменённая запись, made_by — продавец, если
 * владелец выбрал другого. Запись уже в базе: не вышло — только пишем в лог.
 */
export async function saveRecordMaker(
  db: SupabaseClient,
  organizationId: string,
  kind: "sale" | "purchase",
  id: string,
  form: FormData,
) {
  const from = String(form.get("corrected_from") ?? "");
  if (!uuidPattern.test(from)) return;
  const madeBy = String(form.get("made_by") ?? "");
  try {
    const { error } = await db.rpc("set_record_maker", {
      p_org: organizationId,
      p_kind: kind,
      p_id: id,
      p_from: from,
      p_made_by: uuidPattern.test(madeBy) ? madeBy : null,
    });
    if (error) console.error("saveRecordMaker failed", { kind, message: error.message });
  } catch (error) {
    console.error("saveRecordMaker failed", error);
  }
}
