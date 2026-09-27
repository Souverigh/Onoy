/**
 * Дата и время перевода из чека → значение для <input type="datetime-local">
 * по Бишкеку ("2026-09-26T14:35"). Модель возвращает строку как на чеке:
 * "26.09.2026 14:35", "26.09.26", "2026-09-26 14:35:10", ISO с зоной.
 * Нераспознанное — null: продавец введёт дату сам или оставит «сейчас».
 */
const BISHKEK_OFFSET_MIN = 6 * 60;

const pad = (n: number) => String(n).padStart(2, "0");

function local(y: number, mo: number, d: number, h: number, mi: number): string | null {
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== mo - 1 ||
    probe.getUTCDate() !== d ||
    h > 23 ||
    mi > 59
  )
    return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;
}

export function receiptDateTime(raw: string | null | undefined): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // ISO с зоной (Z или ±hh:mm) — переводим в Бишкек.
  const zoned = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.exec(s);
  if (zoned) {
    const t = Date.parse(s.replace(" ", "T"));
    if (Number.isNaN(t)) return null;
    const b = new Date(t + BISHKEK_OFFSET_MIN * 60_000);
    return local(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate(), b.getUTCHours(), b.getUTCMinutes());
  }

  const time = /(?:[T\s,]+(\d{1,2}):(\d{2})(?::\d{2})?)?$/;
  const iso = new RegExp(/^(\d{4})-(\d{1,2})-(\d{1,2})/.source + time.source).exec(s);
  if (iso)
    return local(+iso[1], +iso[2], +iso[3], +(iso[4] ?? 0), +(iso[5] ?? 0));

  const ru = new RegExp(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})/.source + time.source).exec(s);
  if (ru) {
    const year = ru[3].length === 2 ? 2000 + +ru[3] : +ru[3];
    return local(year, +ru[2], +ru[1], +(ru[4] ?? 0), +(ru[5] ?? 0));
  }
  return null;
}

/** Значение datetime-local (время Бишкека) → ISO с зоной для базы. */
export function bishkekDateTime(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || !local(+m[1], +m[2], +m[3], +m[4], +m[5])) return null;
  return `${value}:00+06:00`;
}
