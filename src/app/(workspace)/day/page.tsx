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

/** Дата операции по Бишкеку (YYYY-MM-DD) — день меняется в 00:00 UTC+6. */
function bishkekDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bishkek",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

const HISTORY_DAYS = 14;

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
  const today = bishkekToday();
  // Будущие дни не показываем — сразу сегодняшний.
  const date =
    rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today;
  const { start, end } = dayBounds(date);
  const isToday = date === today;
  const historyStart = new Date(
    new Date(dayBounds(today).start).getTime() - (HISTORY_DAYS - 1) * 86400000,
  ).toISOString();

  const [salesResult, paymentsResult, purchasesResult, pendingResult, laterResult, historyResult] =
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
      // Долг на конец прошлого дня = текущий долг минус всё, что было после.
      isToday ? Promise.resolve(null) : laterMovements(db, organizationId, end),
      dayHistory(db, organizationId, historyStart),
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
  const receivableNow = (customerBalances.data ?? []).reduce(
    (sum, c) => sum + Number(c.balance),
    0,
  );
  const payableNow = (supplierBalances.data ?? []).reduce(
    (sum, s) => sum + Number(s.balance),
    0,
  );
  const receivableEvening = receivableNow - (laterResult?.receivable ?? 0);
  const payableEvening = payableNow - (laterResult?.payable ?? 0);
  const receivableMorning = receivableEvening - soldCredit + incoming.reduce((s, p) => s + Number(p.amount), 0);
  const payableMorning = payableEvening - purchasesTotal + paidToSuppliers;

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
      <form className="day-picker" action="/day">
        <label>
          Показать день
          <input type="date" name="date" defaultValue={date} max={today} />
        </label>
        <button className="button" type="submit">
          Открыть
        </button>
        {!isToday && (
          <Link className="text-button" href="/day">
            Сегодня
          </Link>
        )}
      </form>
      <p className="operation-hint">
        {isToday
          ? "День идёт: цифры обновляются с каждой записью. Новый день начинается в 00:00 по Бишкеку."
          : "Прошедший день. Записи, отменённые позже, сюда не входят."}
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
          <p className="muted">
            {isToday ? "Сегодня продаж в долг не было." : "Продаж в долг не было."}
          </p>
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
      <section className="panel">
        <h2>По дням</h2>
        <div className="table-wrap">
          <table className="day-history">
            <thead>
              <tr>
                <th>День</th>
                <th>Продано</th>
                <th>Собрано</th>
                <th>Приход</th>
              </tr>
            </thead>
            <tbody>
              {historyResult.map((row) => (
                <tr key={row.date} className={row.date === date ? "day-history-current" : ""}>
                  <td>
                    <Link href={row.date === today ? "/day" : `/day?date=${row.date}`}>
                      {row.date === today
                        ? "Сегодня"
                        : new Intl.DateTimeFormat("ru-RU", {
                            timeZone: "Asia/Bishkek",
                            day: "numeric",
                            month: "short",
                            weekday: "short",
                          }).format(new Date(`${row.date}T12:00:00+06:00`))}
                    </Link>
                  </td>
                  <td>{money(row.sold)}</td>
                  <td>{money(row.collected)}</td>
                  <td>{money(row.purchased)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

type Db = Awaited<ReturnType<typeof getContext>>["db"];

/** Как изменились долги начиная с момента `from` (только действующие записи). */
async function laterMovements(db: Db, organizationId: string, from: string) {
  const [sales, payments, purchases] = await Promise.all([
    db
      .from("sales")
      .select("total")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .eq("paid_immediately", false)
      .is("reversed_at", null)
      .gte("occurred_at", from),
    db
      .from("payments")
      .select("direction,amount")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .is("reversed_at", null)
      .gte("occurred_at", from),
    db
      .from("purchases")
      .select("total")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .gte("occurred_at", from),
  ]);
  if (sales.error || payments.error || purchases.error)
    throw new Error("Не удалось загрузить итог дня");
  const pays = payments.data ?? [];
  const total = (rows: { total: string }[]) => rows.reduce((s, r) => s + Number(r.total), 0);
  const paid = (direction: string) =>
    pays.filter((p) => p.direction === direction).reduce((s, p) => s + Number(p.amount), 0);
  return {
    receivable: total(sales.data ?? []) - paid("incoming"),
    payable: total(purchases.data ?? []) - paid("outgoing"),
  };
}

/** Короткий итог за последние дни — от нового к старому, включая пустые дни. */
async function dayHistory(db: Db, organizationId: string, from: string) {
  const [sales, payments, purchases] = await Promise.all([
    db
      .from("sales")
      .select("total,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .gte("occurred_at", from)
      .range(0, 4999),
    db
      .from("payments")
      .select("amount,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "confirmed")
      .eq("direction", "incoming")
      .is("reversed_at", null)
      .gte("occurred_at", from)
      .range(0, 4999),
    db
      .from("purchases")
      .select("total,occurred_at")
      .eq("organization_id", organizationId)
      .eq("status", "posted")
      .is("reversed_at", null)
      .gte("occurred_at", from)
      .range(0, 4999),
  ]);
  if (sales.error || payments.error || purchases.error)
    throw new Error("Не удалось загрузить итог дня");
  const days = new Map<string, { date: string; sold: number; collected: number; purchased: number }>();
  const startMs = new Date(from).getTime();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const date = bishkekDate(new Date(startMs + i * 86400000 + 12 * 3600000).toISOString());
    days.set(date, { date, sold: 0, collected: 0, purchased: 0 });
  }
  for (const r of sales.data ?? []) {
    const d = days.get(bishkekDate(r.occurred_at));
    if (d) d.sold += Number(r.total);
  }
  for (const r of payments.data ?? []) {
    const d = days.get(bishkekDate(r.occurred_at));
    if (d) d.collected += Number(r.amount);
  }
  for (const r of purchases.data ?? []) {
    const d = days.get(bishkekDate(r.occurred_at));
    if (d) d.purchased += Number(r.total);
  }
  return [...days.values()];
}
