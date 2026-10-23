const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Запись взамен другой («Исправить», «Открыть заново»; миграция
 * atomic_correction.sql): поля формы corrected_from — заменяемая запись,
 * made_by — продавец, если владелец выбрал другого. Есть — запись идёт через
 * commit_*_correction: новая пишется и старая отменяется одной транзакцией,
 * брошенное исправление ничего не меняет.
 */
export function correctionOf(form: FormData): { p_from: string; p_made_by: string | null } | null {
  const from = String(form.get("corrected_from") ?? "");
  if (!uuidPattern.test(from)) return null;
  const madeBy = String(form.get("made_by") ?? "");
  return { p_from: from, p_made_by: uuidPattern.test(madeBy) ? madeBy : null };
}
