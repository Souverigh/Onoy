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
