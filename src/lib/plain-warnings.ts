/** Замечание без русских букв (ИИ ответил по-английски) — заменяем понятным. */
export const FALLBACK_WARNING = "Часть записей читается неуверенно - сверьте строки с тетрадью.";

/**
 * Замечания распознавания — для продавца, не для программиста: только
 * русский текст, без повторов. Английские заменяются одним общим.
 */
export function plainWarnings(raw: unknown[]): string[] {
  const out: string[] = [];
  let foreign = false;
  for (const item of raw) {
    const text = String(item ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (!/[а-яё]/i.test(text)) foreign = true;
    else if (!out.includes(text)) out.push(text.slice(0, 300));
  }
  if (foreign && !out.includes(FALLBACK_WARNING)) out.push(FALLBACK_WARNING);
  return out;
}
