/** Строка воронки (admin_funnel): человек, который сам зарегистрировался. */
export type FunnelRow = {
  user_id: string;
  email: string | null;
  created_at: string;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  org_id: string | null;
  shop_name: string | null;
  business_type: string | null;
  shop_created_at: string | null;
  phone: string | null;
  customers: number | null;
  first_customer_at: string | null;
  first_record_at: string | null;
  last_record_at: string | null;
  records_7d: number | null;
  active_at: string | null;
  paid_at: string | null;
  trial: boolean | null;
  paid_until: string | null;
  pending_invites: number | null;
};

/** Шаги — те же, что «Где сейчас» на странице магазина. */
export const FUNNEL_STEPS = [
  "Зарегистрировались",
  "Подтвердили почту",
  "Создали магазин",
  "Добавили клиентов",
  "Первая запись",
  "3+ записи в неделю",
  "Оплатили",
] as const;

const DAY = 86_400_000;

const stepTimes = (r: FunnelRow) => [
  r.created_at,
  r.confirmed_at,
  r.shop_created_at,
  r.first_customer_at,
  r.first_record_at,
  r.active_at,
  r.paid_at,
];

/** Сколько шагов подряд пройдено (1 — только зарегистрировался). */
export function reached(r: FunnelRow): number {
  const times = stepTimes(r);
  let n = 0;
  while (n < times.length && times[n]) n++;
  return n;
}

/** Числа по шагам, сколько ушло на каждом и где уходят больше всего (до оплаты включительно). */
export function funnel(rows: FunnelRow[]) {
  const levels = rows.map(reached);
  const counts = FUNNEL_STEPS.map((_, i) => levels.filter((n) => n > i).length);
  const drops = counts.map((c, i) => (i === 0 ? 0 : counts[i - 1] - c));
  let worst: number | null = null;
  for (let i = 1; i < drops.length; i++) if (drops[i] > 0 && (worst === null || drops[i] > drops[worst])) worst = i;
  return { counts, drops, worst };
}

/** Кто остановился перед шагом step: прошёл всё до него, а его — нет. */
export const stuckAt = (rows: FunnelRow[], step: number) => rows.filter((r) => reached(r) === step);

/** Обычное время между шагами — медиана по тем, кто прошёл оба. */
export const FUNNEL_TIMES: { label: string; from: number; to: number }[] = [
  { label: "Регистрация → подтвердил почту", from: 0, to: 1 },
  { label: "Почта → создал магазин", from: 1, to: 2 },
  { label: "Магазин → первая запись", from: 2, to: 4 },
  { label: "Первая запись → активен", from: 4, to: 5 },
  { label: "Регистрация → оплата", from: 0, to: 6 },
];
export function medianTime(rows: FunnelRow[], from: number, to: number): number | null {
  const spans = rows
    .map(stepTimes)
    .filter((t) => t[from] && t[to])
    .map((t) => new Date(t[to]!).getTime() - new Date(t[from]!).getTime())
    .filter((ms) => ms >= 0)
    .sort((a, b) => a - b);
  if (!spans.length) return null;
  const mid = Math.floor(spans.length / 2);
  return spans.length % 2 ? spans[mid] : (spans[mid - 1] + spans[mid]) / 2;
}

/** «4 мин», «3 ч», «1 д 6 ч», «5 дней». */
export function durationText(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} мин`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours} ч`;
  const days = Math.floor(ms / DAY);
  const rest = Math.round((ms - days * DAY) / 3_600_000);
  if (days < 3 && rest) return `${days} д ${rest} ч`;
  const d = Math.round(ms / DAY);
  const word = d % 10 === 1 && d % 100 !== 11 ? "день" : [2, 3, 4].includes(d % 10) && ![12, 13, 14].includes(d % 100) ? "дня" : "дней";
  return `${d} ${word}`;
}

/** Подборки «Проблемы» — кому сейчас стоит написать. */
export const PROBLEMS = {
  no_customers: "Создали магазин, но 2+ дня ни одного клиента",
  quiet: "Затихли после активной недели",
  trial_ending: "Пробный кончается через 5 дней, а записей мало",
  invite: "Пригласили продавца, а он не вошёл",
} as const;
export type ProblemKey = keyof typeof PROBLEMS;
export const isProblemKey = (v: unknown): v is ProblemKey => typeof v === "string" && Object.hasOwn(PROBLEMS, v);

export function hasProblem(r: FunnelRow, key: ProblemKey, now: Date, today: string): boolean {
  switch (key) {
    case "no_customers":
      return Boolean(r.shop_created_at) && !r.customers && now.getTime() - new Date(r.shop_created_at!).getTime() >= 2 * DAY;
    case "quiet":
      return Boolean(r.active_at) && !r.records_7d;
    case "trial_ending": {
      if (!r.trial || !r.paid_until) return false;
      const left = Math.round((Date.parse(`${r.paid_until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
      return left >= 0 && left <= 5 && (r.records_7d ?? 0) < 3;
    }
    case "invite":
      return (r.pending_invites ?? 0) > 0;
  }
}

/** Первое сообщение в WhatsApp тому, кто застрял перед шагом step. */
export function stuckText(step: number, shop: string | null): string {
  const name = shop ? ` (${shop})` : "";
  switch (step) {
    case 1:
      return "Здравствуйте! Это Depter. Видим, что вы зарегистрировались, но не подтвердили почту. Письмо не пришло? Поможем.";
    case 2:
      return "Здравствуйте! Это Depter. Вы зарегистрировались, но ещё не создали магазин. Подсказать, как начать?";
    case 3:
      return `Здравствуйте! Это Depter${name}. Магазин создан - подсказать, как добавить клиентов? Старую тетрадь можно перенести по фото.`;
    case 4:
      return `Здравствуйте! Это Depter${name}. Клиенты уже есть - подсказать, как записать первую продажу или оплату?`;
    case 5:
      return `Здравствуйте! Это Depter${name}. Как вам работается? Если что-то неудобно, расскажите - поможем.`;
    default:
      return `Здравствуйте! Это Depter${name}. Подсказать, как продлить Depter после пробного месяца?`;
  }
}
