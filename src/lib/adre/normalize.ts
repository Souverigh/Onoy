import type { InvoiceResult } from "./types";

/**
 * Приводит вывод модели к единому виду до того, как он попадёт в сверку
 * (qty×price=sum) или в document_lines — иначе, например, "240,00" (запятая)
 * не парсится как число в JS (Number → NaN) и расхождение молча считается
 * «сошедшимся». Единицы измерения приводятся к тому же набору, что и
 * `products.unit` (Этап 2), чтобы не плодить варианты написания.
 */
const UNIT_ALIASES: Record<string, string> = {
  "шт": "шт", "шт.": "шт", "штук": "шт", "штука": "шт", "штуки": "шт",
  "pcs": "шт", "pc": "шт", "pieces": "шт",
  "м": "м", "м.": "м", "метр": "м", "метра": "м", "метров": "м", "m": "м",
  "кг": "кг", "кг.": "кг", "килограмм": "кг", "килограмма": "кг", "килограммов": "кг", "kg": "кг",
  "упак": "упак", "упаковка": "упак", "упаковок": "упак", "уп": "упак", "уп.": "упак", "pack": "упак",
  "л": "л", "л.": "л", "литр": "л", "литра": "л", "литров": "л", "l": "л",
};

function normalizeUnit(raw: string): string {
  const key = raw.trim().toLowerCase();
  return UNIT_ALIASES[key] ?? (raw.trim() || "шт");
}

/** "240,00" / " 240 " → "240.00"; не трогает уже корректные значения. */
function normalizeDecimalString(raw: string): string {
  return raw.trim().replace(/\s+/g, "").replace(",", ".");
}

function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function normalizeInvoiceResult(result: InvoiceResult): InvoiceResult {
  return {
    ...result,
    lines: result.lines.map((line) => ({
      ...line,
      name_raw: normalizeName(line.name_raw),
      unit: normalizeUnit(line.unit),
      qty: normalizeDecimalString(line.qty),
      price: normalizeDecimalString(line.price),
      sum: normalizeDecimalString(line.sum),
    })),
  };
}
