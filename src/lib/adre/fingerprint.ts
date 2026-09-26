import { createHash } from "node:crypto";
import type { InvoiceResult } from "./types";

/**
 * Отпечаток содержимого накладной: одна и та же накладная, сфотографированная
 * заново (другой файл, другой ракурс), даёт тот же отпечаток — по нему база
 * находит похожие записи через индекс, без перебора (find_similar_records).
 *
 * В отпечаток входят только позиции (название, количество, цена) и итог —
 * контрагента выбирает продавец, а дата и номер часто не читаются. Название
 * упрощается до букв и цифр, порядок строк не важен: неважно, как Gemini
 * записал «Щит - 4» или «щит-4» и в каком порядке вернул строки.
 */
export function contentFingerprint(result: InvoiceResult): string | null {
  const rows = result.lines
    .map((line) => [simplifyName(line.name_raw), number(line.qty, 3), number(line.price, 2)])
    .filter(([name, qty, price]) => name && qty !== null && price !== null)
    .map((row) => row.join("|"))
    .sort();
  if (rows.length === 0) return null;
  const total = number(result.total_computed, 2);
  return createHash("sha256")
    .update(rows.join("\n") + "\n=" + (total ?? ""))
    .digest("hex");
}

function simplifyName(name: string) {
  return name
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function number(value: string | number, scale: number): string | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(scale) : null;
}
