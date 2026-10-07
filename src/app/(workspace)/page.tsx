import { headers } from "next/headers";
import { getContext } from "@/lib/context";
import { Dashboard, type Reminder, type Summary } from "@/components/dashboard";
import { bishkekDate, dayHistory } from "@/lib/day-summary";
import { recentRecords } from "@/lib/recent";
import { dayMonth } from "@/lib/promise";
import { reminderMessage } from "@/lib/reminder";
import { waPhone } from "@/lib/share";

/** Сколько клиентов показываем в «Кому напомнить сегодня». */
const REMIND_LIMIT = 6;

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; password?: string }> }) {
  const { db, organizationId, organizationName, isOwner, currency: shopCurrency } = await getContext();
  const { error, password } = await searchParams;
  // После «Забыли пароль?» → новый пароль (src/app/auth/actions.ts, updatePassword).
  const passwordNotice =
    password === "changed" ? (
      <p className="notice success" role="status">
        Пароль изменён. Вход на других устройствах закрыт - там нужно войти с новым паролем.
      </p>
    ) : null;
  const review = db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["review", "failed"]);
  // Продавцу итоги магазина не показываем (ТЗ) — и не считаем.
  if (!isOwner) {
    const [recent, reviewResult] = await Promise.all([recentRecords(db, organizationId), review]);
    return (
      <>
        {passwordNotice}
        <Dashboard
          summary={null}
          staff
          ownerOnlyNotice={error === "owner"}
          recent={recent}
          reviewCount={reviewResult.count ?? 0}
        />
      </>
    );
  }
  const today = bishkekDate();
  const [customerBalances, supplierBalances, late, history, claims, reviewResult, recent] = await Promise.all([
    // Долги — по валютам: доллары Хороза со сомами не складываем.
    db
      .from("customer_balances")
      .select("id,name,phone,balance,currency,promised_date,archived_at,merged_into_id")
      .eq("organization_id", organizationId)
      .range(0, 4999),
    db.from("supplier_balances").select("balance,currency").eq("organization_id", organizationId).range(0, 4999),
    // Долг старше 30 дней: неоплаченные продажи старше месяца.
    db
      .from("customer_debt_aging")
      .select("customer_id,oldest_days")
      .eq("organization_id", organizationId)
      .gt("oldest_days", 30)
      .range(0, 4999),
    dayHistory(db, organizationId, 1),
    db
      .from("payments")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("status", "pending"),
    review,
    recentRecords(db, organizationId),
  ]);
  if (customerBalances.error || supplierBalances.error) throw new Error("Не удалось загрузить показатели");
  // В тийынах/копейках — без ошибок float.
  const debts = new Map<string, { receivable: number; payable: number }>([[shopCurrency, { receivable: 0, payable: 0 }]]);
  const add = (currency: string | null, key: "receivable" | "payable", value: string) => {
    const cur = currency ?? shopCurrency;
    const d = debts.get(cur) ?? { receivable: 0, payable: 0 };
    d[key] += Math.round(Number(value) * 100);
    debts.set(cur, d);
  };
  for (const c of customerBalances.data ?? []) add(c.currency, "receivable", c.balance);
  for (const s of supplierBalances.data ?? []) add(s.currency, "payable", s.balance);
  const debtTotals = [...debts.entries()].map(([currency, d]) => ({
    currency,
    receivable: d.receivable / 100,
    payable: d.payable / 100,
  }));

  // Кому напомнить сегодня (задача 20): обещал оплатить сегодня или раньше —
  // первыми, потом долг старше 30 дней (самые старые сверху).
  type Row = {
    id: string;
    name: string;
    phone: string | null;
    balance: string;
    currency: string | null;
    promised_date: string | null;
    archived_at: string | null;
    merged_into_id: string | null;
  };
  const oldest = new Map(((late.data ?? []) as { customer_id: string; oldest_days: number }[]).map((r) => [r.customer_id, r.oldest_days]));
  const candidates = ((customerBalances.data ?? []) as Row[])
    .filter((c) => !c.archived_at && !c.merged_into_id && Number(c.balance) > 0)
    .map((c) => {
      const promised = c.promised_date && c.promised_date <= today ? c.promised_date : null;
      const days = oldest.get(c.id) ?? 0;
      return { c, promised, days };
    })
    .filter((x) => x.promised || x.days > 30)
    .sort((a, b) =>
      a.promised && b.promised
        ? a.promised.localeCompare(b.promised)
        : a.promised
          ? -1
          : b.promised
            ? 1
            : b.days - a.days,
    );
  const shown = candidates.slice(0, REMIND_LIMIT);
  const links = shown.length
    ? await db
        .from("share_links")
        .select("customer_id,token")
        .eq("organization_id", organizationId)
        .in("customer_id", shown.map((x) => x.c.id))
        .is("revoked_at", null)
    : { data: [] as { customer_id: string; token: string }[] };
  const tokens = new Map((links.data ?? []).map((l) => [l.customer_id as string, l.token as string]));
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const reminders: Reminder[] = shown.map(({ c, promised, days }) => {
    const currency = c.currency ?? shopCurrency;
    const balance = Number(c.balance);
    const token = tokens.get(c.id);
    const text = reminderMessage({
      shopName: organizationName,
      balance,
      currency,
      promisedDate: c.promised_date,
      today,
      link: token ? `${origin}/c/${token}` : null,
    });
    return {
      id: c.id,
      name: c.name,
      balance,
      currency,
      reason: promised
        ? promised === today
          ? "обещал оплатить сегодня"
          : `обещал до ${dayMonth(promised)}`
        : `долг ${days} дн.`,
      waHref: c.phone && waPhone(c.phone) ? `https://wa.me/${waPhone(c.phone)}?text=${encodeURIComponent(text)}` : null,
    };
  });

  const todayRow = history[0]; // за 1 день — одна строка, сегодня
  return (
    <>
      {passwordNotice}
      <Dashboard
        summary={{ debts: debtTotals } satisfies Summary}
        reminders={reminders}
        remindersMore={candidates.length - shown.length}
        today={
          todayRow
            ? { sold: todayRow.sold, collected: todayRow.collected, expenses: todayRow.expenses, currency: shopCurrency }
            : undefined
        }
        pendingClaims={claims.count ?? 0}
        reviewCount={reviewResult.count ?? 0}
        recent={recent}
      />
    </>
  );
}
