/**
 * Дата продажи или прихода из формы (задача 15, срочно п. 2): "ГГГГ-ММ-ДД"
 * из календаря → полдень того дня по Бишкеку. Пусто или сегодня — null (база
 * запишет «сейчас»); не дата или будущее — "invalid". Старше года проверяет база.
 */
export function recordDateTime(raw: string, today: string): string | null | "invalid" {
  const value = raw.trim();
  if (!value || value === today) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m || value > today) return "invalid";
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (day.getUTCMonth() !== +m[2] - 1 || day.getUTCDate() !== +m[3]) return "invalid";
  return new Date(`${value}T12:00:00+06:00`).toISOString();
}
