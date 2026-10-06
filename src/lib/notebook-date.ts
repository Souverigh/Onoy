/**
 * Дата долга из тетради (задача 26): «15.09», «15.09.26», «15/09/2026» →
 * "2026-09-15". Без года — этот год, а если так выходит в будущем — прошлый.
 * Не похоже на дату — "". Без server-only: считают тесты.
 */
export function notebookDate(raw: string | null | undefined, today: string): string {
  const m = /^\s*(\d{1,2})[./\-\s](\d{1,2})(?:[./\-\s](\d{2}|\d{4}))?\s*$/.exec(String(raw ?? ""));
  if (!m) return "";
  const day = Number(m[1]);
  const month = Number(m[2]);
  const thisYear = Number(today.slice(0, 4));
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : thisYear;
  const iso = (y: number) => `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const valid = (value: string) => {
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  };
  if (!m[3] && iso(year) > today) year -= 1;
  const value = iso(year);
  if (!valid(value) || value > today || year < 2000) return "";
  return value;
}
