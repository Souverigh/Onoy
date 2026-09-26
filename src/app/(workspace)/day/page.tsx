import Link from "next/link";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";

function bishkekToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function DayClose({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { db, organizationId } = await getContext();
  const { date: rawDate } = await searchParams;
  const date = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : bishkekToday();
  const { start, end } = dayBounds(date);

  const [salesResult, paymentsResult, purchasesResult, pendingResult] =
    await Promise.all([
      db
        .from("sales")
        .select("id,customer_id,total,paid_immediately")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .is("reversed_at", null)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("payments")
        .select("id,customer_id,supplier_id,direction,amount,bank_reference")
        .eq("organization_id", organizationId)
        .eq("status", "confirmed")
        .is("reversed_at", null)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("purchases")
        .select("id,supplier_id,total")
        .eq("organization_id", organizationId)
        .eq("status", "posted")
        .is("reversed_at", null)
        .gte("occurred_at", start)
        .lt("occurred_at", end),
      db
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
    ]);
  if (
    salesResult.error ||
    paymentsResult.error ||
    purchasesResult.error
  )
    throw new Error("Не удалось загрузить итог дня");

  const sales = salesResult.data ?? [];
  const payments = paymentsResult.data ?? [];
  const purchases = purchasesResult.data ?? [];

  const creditSales = sales.filter((s) => !s.paid_immediately);
  const cashSales = sales.filter((s) => s.paid_immediately);
  const soldCredit = creditSales.reduce((sum, s) => sum + Number(s.total), 0);
  const soldCash = cashSales.reduce((sum, s) => sum + Number(s.total), 0);

  const incoming = payments.filter((p) => p.direction === "incoming");
  const outgoing = payments.filter((p) => p.direction === "outgoing");
  const collectedCash = incoming
    .filter((p) => !p.bank_reference)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const collectedTransfer = incoming
    .filter((p) => p.bank_reference)
    .reduce((sum, p) => sum + Number(p.amount), 0);
  const paidToSuppliers = outgoing.reduce((sum, p) => sum + Number(p.amount), 0);
  const purchasesTotal = purchases.reduce((sum, p) => sum + Number(p.total), 0);

  const customerTotals = new Map<string, number>();
  for (const sale of creditSales)
    customerTotals.set(
      sale.customer_id,
      (customerTotals.get(sale.customer_id) ?? 0) + Number(sale.total),
    );
  const customerIds = [...customerTotals.keys()];
  const [customerLookup, customerBalances, supplierBalances] = await Promise.all([
    customerIds.length
      ? db.from("customers").select("id,name").eq("organization_id", organizationId).in("id", customerIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    db.from("customer_balances").select("balance").eq("organization_id", organizationId),
    db.from("supplier_balances").select("balance").eq("organization_id", organizationId),
  ]);
  const customerNames = new Map((customerLookup.data ?? []).map((c) => [c.id, c.name]));
  const receivableEvening = (customerBalances.data ?? []).reduce(
    (sum, c) => sum + Number(c.balance),
    0,
  );
  const payableEvening = (supplierBalances.data ?? []).reduce(
    (sum, s) => sum + Number(s.balance),
    0,
  );
  const receivableMorning = receivableEvening - soldCredit + incoming.reduce((s, p) => s + Number(p.amount), 0);
  const payableMorning = payableEvening - purchasesTotal + paidToSuppliers;

  const isToday = date === bishkekToday();
  const prevDate = new Date(new Date(`${date}T00:00:00+06:00`).getTime() - 86400000);
  const nextDate = new Date(new Date(`${date}T00:00:00+06:00`).getTime() + 86400000);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bishkek", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const dateLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "long",
    weekday: "long",
  }).format(new Date(`${date}T12:00:00+06:00`));

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВЕЧЕРНЯЯ СВЕРКА</span>
          <h1>Итог дня</h1>
          <p className="muted">{dateLabel}</p>
        </div>
        <div className="day-nav">
          <Link className="button" href={`/day?date=${fmt(prevDate)}`}>
            ← Вчера
          </Link>
          {!isToday && (
            <Link className="button" href={`/day?date=${fmt(nextDate)}`}>
              Завтра →
            </Link>
          )}
        </div>
      </div>
      <p className="operation-hint">
        Показано текущее состояние на сейчас — снимок и печать «Закрыть день» в
        этой версии пока не сохраняются.
      </p>
      <div className="day-grid">
        <section className="panel">
          <h2>Продано за день</h2>
          <p className="day-number">{money(soldCredit + soldCash)}</p>
          <p className="muted">
            В долг: {money(soldCredit)} · Наличными: {money(soldCash)}
          </p>
        </section>
        <section className="panel">
          <h2>Собрано денег</h2>
          <p className="day-number">{money(collectedCash + collectedTransfer)}</p>
          <p className="muted">
            Наличными: {money(collectedCash)} · Переводом: {money(collectedTransfer)}
          </p>
        </section>
        <section className="panel">
          <h2>Долг клиентов</h2>
          <p className="muted">Было утром: {money(receivableMorning)}</p>
          <p className="day-number">Стало вечером: {money(receivableEvening)}</p>
        </section>
        <section className="panel">
          <h2>Поставщики</h2>
          <p className="muted">Приход за день: {money(purchasesTotal)}</p>
          <p className="muted">Оплачено: {money(paidToSuppliers)}</p>
          <p className="day-number">Долг на конец дня: {money(payableEvening)}</p>
        </section>
      </div>
      <section className="panel">
        <h2>Кому продал в долг</h2>
        {customerTotals.size ? (
          <div className="balance-list">
            {[...customerTotals.entries()].map(([id, total]) => (
              <Link className="balance-row" href={`/customers/${id}`} key={id}>
                <span>{customerNames.get(id) ?? "Клиент"}</span>
                <strong>{money(total)}</strong>
              </Link>
            ))}
          </div>
        ) : (
          <p className="muted">Сегодня продаж в долг не было.</p>
        )}
      </section>
      <section className="panel">
        <h2>Незакрытое</h2>
        <p className="muted">
          Заявок ждут подтверждения: {pendingResult.count ?? 0}
          {pendingResult.count ? (
            <>
              {" "}
              — <Link href="/claims">открыть заявки →</Link>
            </>
          ) : null}
        </p>
      </section>
    </>
  );
}
