import { getContext } from "@/lib/context";
import { Dashboard, type Summary } from "@/components/dashboard";
import { dayHistory, unclosedDays } from "@/lib/day-summary";
import { recentRecords } from "@/lib/recent";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { db, organizationId, isOwner, currency: shopCurrency } = await getContext();
  const { error } = await searchParams;
  const review = db
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .in("status", ["review", "failed"]);
  // Продавцу итоги магазина не показываем (ТЗ) — и не считаем.
  if (!isOwner) {
    const [recent, reviewResult] = await Promise.all([recentRecords(db, organizationId), review]);
    return (
      <Dashboard
        summary={null}
        staff
        ownerOnlyNotice={error === "owner"}
        recent={recent}
        reviewCount={reviewResult.count ?? 0}
      />
    );
  }
  const [customerBalances, supplierBalances, unclosed, late, history, claims, reviewResult, recent] = await Promise.all([
    // Долги — по валютам: доллары Хороза со сомами не складываем.
    db.from("customer_balances").select("id,balance,currency").eq("organization_id", organizationId).range(0, 4999),
    db.from("supplier_balances").select("balance,currency").eq("organization_id", organizationId).range(0, 4999),
    unclosedDays(db, organizationId),
    // Просрочено больше 30 дней: неоплаченные продажи старше месяца.
    db
      .from("customer_debt_aging")
      .select("customer_id,due_31_60,due_61_90,due_over_90")
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
  const customerCurrency = new Map((customerBalances.data ?? []).map((c) => [c.id, c.currency ?? shopCurrency]));
  const lateRows = late.data ?? [];
  const lateByCurrency = new Map<string, number>();
  for (const r of lateRows) {
    const cur = customerCurrency.get(r.customer_id) ?? shopCurrency;
    lateByCurrency.set(
      cur,
      (lateByCurrency.get(cur) ?? 0) + Math.round((Number(r.due_31_60) + Number(r.due_61_90) + Number(r.due_over_90)) * 100),
    );
  }
  const overdue = {
    count: lateRows.length,
    amounts: [...lateByCurrency.entries()]
      .sort(([a], [b]) => (a === shopCurrency ? -1 : b === shopCurrency ? 1 : 0))
      .map(([currency, cents]) => ({ currency, amount: cents / 100 })),
  };
  const todayRow = history[0]; // за 1 день — одна строка, сегодня
  return (
    <Dashboard
      summary={{ debts: debtTotals } satisfies Summary}
      unclosedDays={unclosed}
      overdue={overdue}
      today={
        todayRow
          ? { sold: todayRow.sold, collected: todayRow.collected, expenses: todayRow.expenses, currency: shopCurrency }
          : undefined
      }
      pendingClaims={claims.count ?? 0}
      reviewCount={reviewResult.count ?? 0}
      recent={recent}
    />
  );
}
