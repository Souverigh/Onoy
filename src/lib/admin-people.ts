import type { SubscriptionState } from "./subscription";

/** Строка списка админки (admin_people): магазин или аккаунт без магазина. */
export type PersonRow = {
  kind: "shop" | "account";
  org_id: string | null;
  user_id: string | null;
  name: string | null;
  business_type: string | null;
  email: string | null;
  user_created_at: string | null;
  email_confirmed_at: string | null;
  shop_created_at: string | null;
  phone: string | null;
  seller_name: string | null;
  plan: "basic" | "business" | null;
  paid_until: string | null;
  blocked_at: string | null;
  trial: boolean | null;
  customers: number | null;
  records_7d: number | null;
  first_record_at: string | null;
  last_action_at: string | null;
  last_action: string | null;
  last_action_role: "owner" | "staff" | null;
  last_action_name: string | null;
  next_contact: string | null;
  last_note: string | null;
};

/** ТЗ, метрика пилота: активная точка — ≥ 3 записей в неделю. */
export const ACTIVE_PER_WEEK = 3;

export type StageKey = "unconfirmed" | "no_shop" | "trial" | "active" | "quiet" | "ending" | "unpaid" | "blocked";
export type Tone = "ok" | "trial" | "warn" | "bad" | "gray";

/** Этапы — в порядке счётчиков-фильтров над списком. */
export const STAGES: { key: StageKey; label: string; chip: string; tone: Tone }[] = [
  { key: "unconfirmed", label: "Не подтвердил почту", chip: "Не подтвердили почту", tone: "gray" },
  { key: "no_shop", label: "Без магазина", chip: "Без магазина", tone: "gray" },
  { key: "trial", label: "Пробный", chip: "Пробный месяц", tone: "trial" },
  { key: "active", label: "Активен", chip: "Активные", tone: "ok" },
  { key: "quiet", label: "Затих", chip: "Затихли", tone: "warn" },
  { key: "ending", label: "Оплата кончается", chip: "Оплата кончается", tone: "warn" },
  { key: "unpaid", label: "Не оплачено", chip: "Не оплачено", tone: "bad" },
  { key: "blocked", label: "Заблокирован", chip: "Заблокированы", tone: "bad" },
];
export const isStageKey = (value: unknown): value is StageKey => STAGES.some((s) => s.key === value);

const DAY = 86_400_000;
const dateOnly = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(iso));

/**
 * Где человек сейчас и короткое пояснение под ярлыком. Порядок — от того,
 * что мешает работать (почта, блокировка, оплата), к активности.
 */
export function stageOf(row: PersonRow, sub: SubscriptionState | null): { key: StageKey; note: string | null } {
  if (row.kind === "account")
    return row.email_confirmed_at
      ? { key: "no_shop", note: `почта подтверждена ${dateOnly(row.email_confirmed_at)}` }
      : { key: "unconfirmed", note: null };
  if (sub?.kind === "blocked") return { key: "blocked", note: sub.reason || null };
  if (sub?.kind === "grace") return { key: "unpaid", note: `льготная неделя до ${dateOnly(sub.graceUntil)}` };
  if (sub?.kind === "expired") return { key: "unpaid", note: "только просмотр" };
  const records = row.records_7d ?? 0;
  const idle = !row.first_record_at ? "ни одной записи" : records === 0 ? "7+ дней без записей" : null;
  if (sub?.kind === "ending")
    return {
      key: "ending",
      note: `${row.trial ? "пробный кончается" : "кончается"} через ${sub.daysLeft} дн.`,
    };
  if (records >= ACTIVE_PER_WEEK) return { key: "active", note: null };
  if (row.trial) return { key: "trial", note: idle };
  if (records === 0) return { key: "quiet", note: idle };
  return { key: "active", note: "мало записей" };
}

/** Действие из журнала (audit_events.action) — словами для админа. */
const ACTIONS: Record<string, string> = {
  "auth.login": "вход",
  "auth.confirmed": "подтвердил почту",
  "auth.signup": "зарегистрировался",
  "organization.created": "создал магазин",
  "organization.business_profile": "сменил вид бизнеса",
  "sale.posted": "продажа",
  "sale.stocked": "продажа",
  "sale.reversed": "отмена продажи",
  "purchase.posted": "приход товара",
  "purchase.stocked": "приход товара",
  "purchase.reversed": "отмена прихода",
  "payment.received": "оплата долга",
  "payment.paid": "оплата поставщику",
  "payment.reversed": "отмена оплаты",
  "opening.imported": "перенос тетради",
  "products.imported": "импорт товаров",
  "expense.created": "расход",
  "day.closed": "закрытие дня",
  "rental.issued": "выдача проката",
  "rental.returned": "возврат проката",
  "rental.items_returned": "возврат проката",
  "member.invited": "пригласил продавца",
};
const PREFIXES: [string, string][] = [
  ["sale.", "продажа"],
  ["purchase.", "приход товара"],
  ["payment.claim", "заявка «Я оплатил»"],
  ["payment.", "оплата"],
  ["rental.", "прокат"],
  ["product", "товары"],
  ["categor", "товары"],
  ["document.", "документы"],
  ["draft.", "черновик"],
  ["party.", "клиенты и поставщики"],
  ["catalog", "каталог"],
  ["adjustment.", "склад"],
  ["push.", "уведомления"],
];
export function actionLabel(action: string | null): string {
  if (!action) return "-";
  return ACTIONS[action] ?? PREFIXES.find(([p]) => action.startsWith(p))?.[1] ?? "действие";
}

export const whoLabel = (role: string | null, name: string | null) =>
  role === "staff" ? name || "продавец" : "владелец";

const bishkekDay = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** «сегодня, 14:32», «вчера, 19:05», «22 окт, 11:47» — по Бишкеку. */
export function whenText(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", hour: "2-digit", minute: "2-digit" }).format(at);
  const day = bishkekDay(at);
  if (day === bishkekDay(now)) return `сегодня, ${time}`;
  if (day === bishkekDay(new Date(now.getTime() - DAY))) return `вчера, ${time}`;
  const sameYear = day.slice(0, 4) === bishkekDay(now).slice(0, 4);
  const date = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(at);
  return `${date.replace(/\.$/, "").replace(" г.", "")}, ${time}`;
}

/** «12 мин назад», «3 ч назад» — только в первые сутки. */
export function agoText(iso: string, now = new Date()): string | null {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} ч назад`;
  return null;
}

/** Первое сообщение в WhatsApp — под этап, чтобы не писать каждый раз заново. */
export function waText(stage: StageKey, shopName: string | null): string {
  const shop = shopName ? ` (${shopName})` : "";
  switch (stage) {
    case "unconfirmed":
      return "Здравствуйте! Это Depter. Видим, что вы зарегистрировались, но не подтвердили почту. Письмо не пришло? Поможем.";
    case "no_shop":
      return "Здравствуйте! Это Depter. Вы зарегистрировались, но ещё не создали магазин. Подсказать, как начать?";
    case "quiet":
      return `Здравствуйте! Это Depter${shop}. Давно не видели записей - всё ли получается? Если что-то неудобно, расскажите, поможем.`;
    case "ending":
      return `Здравствуйте! Это Depter${shop}. Скоро заканчивается оплаченный период - подсказать, как продлить?`;
    case "unpaid":
      return `Здравствуйте! Это Depter${shop}. Оплата закончилась, записи сейчас только для просмотра. Подсказать, как продлить?`;
    default:
      return `Здравствуйте! Это Depter${shop}. Как вам работается? Если есть вопросы - пишите.`;
  }
}

/** Новая дата «оплачено до»: от сегодняшней или ещё не прошедшей даты. */
export function extendPaidUntil(current: string | null, today: string, add: { days?: number; months?: number }): string {
  const base = current && current > today ? current : today;
  const d = new Date(`${base}T00:00:00Z`);
  if (add.months) {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + add.months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  if (add.days) d.setUTCDate(d.getUTCDate() + add.days);
  return d.toISOString().slice(0, 10);
}
