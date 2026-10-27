/** Распознавание идёт меньше минуты; дольше 15 — уже не закончится само. */
const STUCK_MS = 15 * 60 * 1000;

/**
 * Фото так и не прочиталось: «Читаем фото» висит дольше 15 минут (сбой или
 * прервалось). Показываем «Не прочиталось» и кнопку распознать заново —
 * иначе статус висит неделями, а сделать ничего нельзя.
 */
export function recognitionStuck(doc: { status: string; created_at: string }, now = Date.now()): boolean {
  return (doc.status === "uploaded" || doc.status === "processing") && now - Date.parse(doc.created_at) > STUCK_MS;
}
