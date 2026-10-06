// Поиск клиента или поставщика в форме (задача 12): по имени, синонимам и
// телефону — как бы номер ни записали. Без server-only: считают тесты.

export type SearchableParty = { id: string; name: string; phone?: string | null; aliases?: string[] | null };

const plain = (value: string) =>
  value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export function searchParties<T extends SearchableParty>(query: string, parties: T[], limit = 8): T[] {
  const q = plain(query);
  if (!q) return parties.slice(0, limit);
  const words = q.split(" ").filter((w) => !/^\d+$/.test(w));
  const digits = query.replace(/\D/g, "");
  const scored: { party: T; score: number }[] = [];
  for (const party of parties) {
    const texts = [party.name, ...(party.aliases ?? [])].map(plain);
    let score = 0;
    if (words.length && texts.some((t) => words.every((w) => t.includes(w))))
      score = texts.some((t) => t.startsWith(words[0]) || t.includes(` ${words[0]}`)) ? 3 : 2;
    const phone = (party.phone ?? "").replace(/\D/g, "");
    if (digits.length >= 3 && phone.includes(digits)) score = Math.max(score, words.length ? score : 3);
    if (digits.length >= 3 && words.length === 0 && !phone.includes(digits)) score = 0;
    if (score) scored.push({ party, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.party.name.localeCompare(b.party.name, "ru"))
    .slice(0, limit)
    .map((x) => x.party);
}
