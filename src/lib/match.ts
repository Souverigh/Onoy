/**
 * Нечёткое сопоставление имён контрагентов (ТЗ §6): без внешних библиотек и
 * без pg_trgm (недоступно в тестовом PGlite) — коэффициент Дайса по биграммам
 * после нормализации. Устойчиво к сокращениям и мелким опечаткам, не требует
 * словаря транслитерации.
 */

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
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
  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return na === nb ? 1 : 0;
  let overlap = 0;
  for (const gram of ba) if (bb.has(gram)) overlap++;
  return (2 * overlap) / (ba.size + bb.size);
}

export type MatchCandidate = { id: string; name: string; aliases?: string[] };
export type Match<T extends MatchCandidate> = { candidate: T; score: number };

/** Лучший счёт по имени кандидата и по каждому известному синониму. */
function bestScoreFor(query: string, candidate: MatchCandidate): number {
  let best = similarity(query, candidate.name);
  for (const alias of candidate.aliases ?? []) {
    const score = similarity(query, alias);
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
