import type { InvoiceLine } from "./adre/types";

/**
 * Нечёткое сопоставление имён контрагентов (ТЗ §6): без внешних библиотек и
 * без pg_trgm (недоступно в тестовом PGlite) — коэффициент Дайса по биграммам
 * после нормализации. Устойчиво к сокращениям и мелким опечаткам, не требует
 * словаря транслитерации.
 */

// Латиница с накладной («Horoz Electric Asia») против кириллицы в списке
// («Короз электрик»): сравниваем в одной азбуке. Сначала сочетания букв.
const LATIN_PAIRS: [RegExp, string][] = [
  [/shch/g, "щ"],
  [/sh/g, "ш"],
  [/ch/g, "ч"],
  [/zh/g, "ж"],
  [/kh/g, "х"],
  [/ts/g, "ц"],
  [/ya/g, "я"],
  [/yu/g, "ю"],
  [/yo/g, "е"],
];
const LATIN: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", p: "п", q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс", y: "ы", z: "з",
};
function cyrillic(value: string): string {
  let text = value;
  for (const [pair, letter] of LATIN_PAIRS) text = text.replace(pair, letter);
  return text.replace(/[a-z]/g, (ch) => LATIN[ch] ?? ch);
}

// Вежливые слова при имени: из-за одного общего «ака» имена не похожи
// («Канат ака» — не «Бакыт ака»).
const HONORIFICS = new Set(["ака", "аке", "акe", "эже", "эжеке", "еже", "ежеке", "байке", "агай", "апа", "апче", "байке", "мырза", "ага", "баке", "уулу", "кызы"]);

function normalize(value: string): string {
  const plain = cyrillic(
    value
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s]/gu, " "),
  )
    .replace(/э/g, "е")
    .replace(/\s+/g, " ")
    .trim();
  const words = plain.split(" ").filter((w) => !HONORIFICS.has(w));
  return words.length ? words.join(" ") : plain;
}

/**
 * Все значимые слова кандидата есть в имени с документа (по написанию
 * похожи): «Короз электрик» в «Horoz Electric Asia». Только для имён из
 * двух слов и больше — одно общее имя («Айбек») ещё не тот же человек.
 */
function wordsCover(query: string, candidate: string): number {
  const words = candidate.split(" ").filter((w) => w.length >= 3);
  const tokens = query.split(" ").filter((w) => w.length >= 3);
  if (words.length < 2 || !tokens.length) return 0;
  const scores = words.map((w) => Math.max(...tokens.map((t) => (t === w ? 1 : dice(w, t)))));
  if (scores.some((s) => s < 0.7)) return 0;
  return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

function dice(na: string, nb: string): number {
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return na === nb ? 1 : 0;
  let overlap = 0;
  for (const gram of ba) if (bb.has(gram)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) set.add(value.slice(i, i + 2));
  return set;
}

export function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return dice(na, nb);
}

/** Имя с документа против имени в списке: похожесть целиком или по словам кандидата. */
function nameScore(query: string, name: string): number {
  const nq = normalize(query);
  const nn = normalize(name);
  if (!nq || !nn) return 0;
  if (nq === nn) return 1;
  return Math.max(dice(nq, nn), wordsCover(nq, nn));
}

export type MatchCandidate = { id: string; name: string; aliases?: string[] | null };
export type Match<T extends MatchCandidate> = { candidate: T; score: number };

/** Лучший счёт по имени кандидата и по каждому известному синониму. */
function bestScoreFor(query: string, candidate: MatchCandidate): number {
  let best = nameScore(query, candidate.name);
  for (const alias of candidate.aliases ?? []) {
    const score = nameScore(query, alias);
    if (score > best) best = score;
  }
  return best;
}

export function bestMatches<T extends MatchCandidate>(
  query: string,
  candidates: T[],
  limit = 3,
  minScore = 0.3,
): Match<T>[] {
  return candidates
    .map((candidate) => ({ candidate, score: bestScoreFor(query, candidate) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Поиск товара в форме продажи: по коду, названию и синонимам. Без запроса —
 * частые (сколько раз продавали за 90 дней), затем по алфавиту. С запросом:
 * точный код → все слова запроса есть в названии/синониме (раньше — где
 * начало совпало) → похожие по написанию (опечатки, «вввг» вместо «ввг»).
 */
export type SearchableProduct = {
  id: string;
  name: string;
  sku?: string | null;
  aliases?: string[] | null;
  sold_count?: number | null;
};

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    // 3*2,5 / 3x2.5 / 3х2,5 — одно и то же
    .replace(/(\d)\s*[x×х*]\s*(?=\d)/g, "$1x")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^\p{L}\p{N}.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rank(raw: string, query: string, words: string[], product: SearchableProduct): number {
  // Код сравниваем как есть: «C-400» без нормализации (дефис — часть кода).
  const sku = (product.sku ?? "").toLowerCase().trim();
  if (sku && (sku === raw || sku === query)) return 1000;
  const texts = [product.name, ...(product.aliases ?? [])].map(normalizeText);
  let best = 0;
  for (const text of texts) {
    if (words.every((w) => text.includes(w))) {
      const score = text.startsWith(words[0]) ? 500 : text.split(" ").some((t) => t.startsWith(words[0])) ? 400 : 300;
      best = Math.max(best, score);
    }
  }
  if (sku && (sku.startsWith(raw) || sku.startsWith(query))) best = Math.max(best, 450);
  if (best) return best;
  // Опечатки: похожесть по биграммам всего названия и каждого слова.
  let fuzzy = 0;
  for (const text of texts) {
    fuzzy = Math.max(fuzzy, similarity(query, text));
    const tokens = text.split(" ");
    const perWord = words.map((w) => Math.max(0, ...tokens.map((t) => similarity(w, t))));
    fuzzy = Math.max(fuzzy, perWord.reduce((s, x) => s + x, 0) / perWord.length);
  }
  return fuzzy >= 0.55 ? Math.round(fuzzy * 100) : 0;
}

export function searchProducts<T extends SearchableProduct>(query: string, products: T[], limit = 20): T[] {
  const q = normalizeText(query);
  const byPopularity = (a: T, b: T) =>
    (b.sold_count ?? 0) - (a.sold_count ?? 0) || a.name.localeCompare(b.name, "ru");
  if (!q) return [...products].sort(byPopularity).slice(0, limit);
  const raw = query.trim().toLowerCase();
  const words = q.split(" ");
  return products
    .map((product) => ({ product, score: rank(raw, q, words, product) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || byPopularity(a.product, b.product))
    .slice(0, limit)
    .map((x) => x.product);
}

/**
 * Строки накладной продажи против склада (просьба пользователя 15.10.2026):
 * точное название списывается само, похожее — только после «Да» продавца.
 */
export type StockProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  /** Цена продажи в валюте магазина; 0 — не указана. */
  sale_price: string;
  stock: string;
  aliases: string[] | null;
  sold_count: number | null;
};

/** Как private.plain_name в базе: регистр, «ё» и пробелы не важны. */
export function plainName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");
}

const textsOf = (product: StockProduct) => [product.name, ...(product.aliases ?? [])];

/** Точное совпадение с названием или синонимом; название важнее синонима — как в базе. */
export function exactProduct<T extends StockProduct>(name: string, products: T[]): T | null {
  const plain = plainName(name);
  if (!plain) return null;
  return (
    products.find((p) => plainName(p.name) === plain) ??
    products.find((p) => (p.aliases ?? []).some((a) => plainName(a) === plain)) ??
    null
  );
}

/** Числа названия: 9W, 3х1,5, 220V — у разных товаров отличаются только ими. */
function numbersOf(value: string): string {
  return (normalizeText(value).match(/\d+(?:\.\d+)?/g) ?? [])
    .map((n) => String(Number(n)))
    .sort()
    .join(" ");
}

/** Слова короче трёх букв (и, с, w) похожесть не решают. */
const wordsOf = (value: string) =>
  normalizeText(value)
    .replace(/\d+(?:\.\d+)?/g, " ")
    .split(" ")
    .filter((w) => w.length >= 3);

/**
 * Похожесть по словам: каждое слово строки ищем среди слов товара
 * («Лампочка 9 ватт Хороз» — «Лампа LED 9W Horoz»), и наоборот; берём
 * меньшее, чтобы короткое название не подходило ко всему подряд.
 */
function wordScore(a: string, b: string): number {
  const wa = wordsOf(a);
  const wb = wordsOf(b);
  if (!wa.length || !wb.length) return 0;
  const cover = (from: string[], to: string[]) =>
    from.reduce((sum, w) => sum + Math.max(...to.map((t) => similarity(w, t))), 0) / from.length;
  return Math.min(cover(wa, wb), cover(wb, wa));
}

/** Ниже — уже не «тот же товар, написан иначе». */
export const SUGGEST_SCORE = 0.55;

/**
 * Похожий товар для строки без точного совпадения: числа в названии
 * совпадают все (иначе это другой размер или мощность), слова похожи.
 */
export function suggestProduct<T extends StockProduct>(name: string, products: T[]): T | null {
  if (!plainName(name)) return null;
  const numbers = numbersOf(name);
  let best: { product: T; score: number } | null = null;
  for (const product of products) {
    for (const text of textsOf(product)) {
      if (numbersOf(text) !== numbers) continue;
      const score = Math.max(similarity(name, text), wordScore(name, text));
      if (score >= SUGGEST_SCORE && (!best || score > best.score)) best = { product, score };
    }
  }
  return best?.product ?? null;
}

/** Выбор продавца по строке: id товара или null — «Не списывать со склада». */
export type StockChoices = Record<number, string | null>;

/** Товар строки: выбор продавца, иначе точное совпадение; похожий — только после «Да». */
export function chosenProduct(line: InvoiceLine, products: StockProduct[], choices: StockChoices): StockProduct | null {
  if (line.n in choices) {
    const id = choices[line.n];
    return id ? (products.find((p) => p.id === id) ?? null) : null;
  }
  return exactProduct(line.name_raw, products);
}

/** Цена на фото есть: строка без цены — «0» или пусто. */
const hasPrice = (line: InvoiceLine) => line.price.trim() !== "" && Number(line.price) > 0;

/** Какую цену со склада поставили строке: номер строки → товар и цена. */
export type StockPrices = Record<number, { product: string; price: string }>;

const withPrice = (line: InvoiceLine, price: string): InvoiceLine => ({
  ...line,
  price,
  sum: price === "" ? "" : String(Math.round(Number(line.qty) * Number(price) * 100) / 100),
});

/**
 * Строки без цены на фото берут цену продажи товара со склада (просьба
 * пользователя 16.10.2026). Продавец сменил товар — цена прежнего уходит,
 * ставится цена нового. Цену, которую продавец исправил сам, не трогаем.
 * null — менять нечего.
 */
export function linesWithStockPrices(
  lines: InvoiceLine[],
  products: StockProduct[],
  choices: StockChoices,
  given: StockPrices = {},
): { lines: InvoiceLine[]; given: StockPrices } | null {
  let changed = false;
  const nextGiven: StockPrices = {};
  const next = lines.map((line) => {
    const product = chosenProduct(line, products, choices);
    const before = given[line.n];
    // Цена стоит наша и товар тот же — оставляем.
    if (before && before.price === line.price && before.product === product?.id) {
      nextGiven[line.n] = before;
      return line;
    }
    // Цена наша, а товар сменили или убрали — снимаем её.
    const own = before && before.price === line.price;
    const base = own ? withPrice(line, "") : line;
    if (own) changed = true;
    if (hasPrice(base) || !(Number(base.qty) > 0) || !product || !(Number(product.sale_price) > 0)) return base;
    changed = true;
    const price = String(Number(product.sale_price));
    nextGiven[line.n] = { product: product.id, price };
    return withPrice(base, price);
  });
  return changed ? { lines: next, given: nextGiven } : null;
}
