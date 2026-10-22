import type { SupabaseClient } from "@supabase/supabase-js";

/** Длина комментария к продаже, приходу или оплате — как ограничение в базе (record_note.sql). */
export const NOTE_MAX = 500;

/** Комментарий из формы: без лишних пробелов по краям, не длиннее NOTE_MAX. */
export function noteInput(raw: FormDataEntryValue | null): string {
  return typeof raw === "string" ? raw.trim().slice(0, NOTE_MAX) : "";
}

/**
 * Комментарий к только что записанной продаже, приходу или оплате. Запись уже в базе:
 * если комментарий не сохранился, запись не теряем — только пишем в лог.
 */
export async function saveRecordNote(
  db: SupabaseClient,
  organizationId: string,
  kind: "sale" | "purchase" | "payment",
  id: string,
  note: string,
) {
  if (!note) return;
  try {
    const { error } = await db.rpc("set_record_note", { p_org: organizationId, p_kind: kind, p_id: id, p_note: note });
    if (error) console.error("saveRecordNote failed", { kind, message: error.message });
  } catch (error) {
    console.error("saveRecordNote failed", error);
  }
}
