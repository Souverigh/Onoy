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

// Знаки повтора в начале строки: 〃, -//-, «то же». Кавычки (" или '')
// тоже бывают повтором, но с них может начинаться и название («"Кнауф"
// гипс») — их снимаем, только когда слова в строке нет.
const DITTO = /^(?:〃|[-–—]*\s*\/\/\s*[-–—]*|то\s*же)\s*/i;
const QUOTES = /^["'“”«»]+\s*/;
const WORD = /[a-zа-яё]{3,}/i;

/**
 * Основа названия и разделитель до размера: «Щит - 4» → { base: "Щит",
 * separator: " - " }, «Хомуты 150» → { base: "Хомуты", separator: " " }.
 * Основа — слова до первого токена с цифрой.
 */
function nameBase(name: string): { base: string; separator: string } | null {
  const match = name.match(/^(.*?[a-zа-яё].*?)(\s*[-–—]?\s*)(?=\S*\d)/i);
  if (!match) return { base: name, separator: " " };
  const base = match[1].trim();
  return base ? { base, separator: match[2] || " " } : null;
}

/**
 * Рукописная накладная: название пишут один раз, ниже — только размер
 * («-8», «200», «3/5», «2й») или знак повтора. Такой строке возвращаем
 * название из строки выше: «Щит - 8». Страховка на случай, если модель не
 * выполнила это правило из промпта. Строка с настоящим словом (3+ буквы
 * подряд) считается полным названием и начинает новую группу.
 */
function expandAbbreviatedNames<T extends { name_raw: string }>(lines: T[]): T[] {
  let group: { base: string; separator: string } | null = null;
  return lines.map((line) => {
    const hadDitto = DITTO.test(line.name_raw);
    const rest = line.name_raw.replace(DITTO, "").replace(/^[-–—]\s*/, "").trim();
    if (!WORD.test(rest)) {
      if (!group) return line;
      const size = rest.replace(QUOTES, "").trim();
      const name = size ? `${group.base}${group.separator}${size}` : group.base;
      return { ...line, name_raw: name };
    }
    if (hadDitto && group) return { ...line, name_raw: `${group.base} ${rest}` };
    group = nameBase(line.name_raw);
    return line;
  });
}

/**
 * Итог по строкам считаем сами: модель (особенно с thinkingLevel=low) ошибается
 * в сложении длинных накладных, а qty×price — простая арифметика. Строка без
 * читаемых qty/price берёт свою сумму с бумаги. В тийынах — без ошибок float.
 */
function computeTotal(result: InvoiceResult): number {
  if (result.lines.length === 0) return Number(result.total_computed) || 0;
  let cents = 0;
  for (const line of result.lines) {
    const qty = Number(line.qty);
    const price = Number(line.price);
    const sum = Number(line.sum);
    if (line.qty !== "" && line.price !== "" && Number.isFinite(qty) && Number.isFinite(price)) {
      cents += Math.round(qty * price * 100);
    } else if (line.sum !== "" && Number.isFinite(sum)) {
      cents += Math.round(sum * 100);
    }
  }
  return cents / 100;
}

/**
 * document_lines требует qty > 0 и число в цене. Строка без количества или
 * цены, но с суммой («Скидка -200») становится 1 × сумма; отрицательное
 * количество (возврат) переносит знак в цену. Иначе одна такая строка
 * роняет сохранение всей накладной.
 */
function lineShape<T extends { qty: string; price: string; sum: string }>(line: T): T {
  const readable = (v: string) => v !== "" && Number.isFinite(Number(v));
  if (readable(line.qty) && readable(line.price)) {
    const qty = Number(line.qty);
    if (qty > 0) return line;
    if (qty < 0)
      return { ...line, qty: line.qty.replace(/^-/, ""), price: negate(line.price) };
  }
  if (readable(line.sum)) return { ...line, qty: "1", price: line.sum };
  return line;
}

function negate(value: string): string {
  return value.startsWith("-") ? value.slice(1) : Number(value) === 0 ? value : `-${value}`;
}

export function normalizeInvoiceResult(result: InvoiceResult): InvoiceResult {
  const normalized = {
    ...result,
    lines: expandAbbreviatedNames(
      result.lines.map((line) =>
        lineShape({
          ...line,
          name_raw: normalizeName(line.name_raw),
          unit: normalizeUnit(line.unit),
          qty: normalizeDecimalString(line.qty),
          price: normalizeDecimalString(line.price),
          sum: normalizeDecimalString(line.sum),
        }),
      ),
    ),
  };
  return { ...normalized, total_computed: computeTotal(normalized) };
}
