/**
 * Дата «28.09.2026» и время «14:35» (24 часа) — как принято в Кыргызстане.
 * Внутри — "ГГГГ-ММ-ДД" и "ГГГГ-ММ-ДДTчч:мм" (время Бишкека), как ждёт сервер.
 */
const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-28" → "28.09.2026". */
export function ruDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

/** "28.09.2026" → "2026-09-28", если такая дата есть. */
export function isoDate(text: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** "9:05" / "14:35" → "09:05" / "14:35", если часы и минуты в пределах. */
export function isoTime(text: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return `${pad(+m[1])}:${m[2]}`;
}

/** Цифры → «дд.мм.гггг» по мере набора. */
export function maskDate(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join(".");
}

/** Цифры → «чч:мм» по мере набора. */
export function maskTime(raw: string) {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

/** Сейчас по Бишкеку (UTC+6): "ГГГГ-ММ-ДДTчч:мм". */
export function bishkekNow(now = Date.now()) {
  const b = new Date(now + 6 * 3600_000);
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}T${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`;
}
