import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { period } from "@/lib/periods";
import { kitchenDishes } from "@/lib/kitchen-report";
import { ReportTabs } from "@/components/report-tabs";
import { DishReport, MonthNav, monthWord } from "@/components/kitchen-report";

/** Отчёты → «Блюда» (модуль «kitchen»): что приносит деньги, что продают, что невыгодно. */
export default async function DishesReport({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const params = await searchParams;
  const offset = Math.min(0, Math.max(-120, parseInt(params.offset ?? "0") || 0));
  const today = bishkekDate();
  const p = period("month", today, offset);
  const { db, organizationId, currency, modules } = await requireOwner();
  if (!modules.includes("kitchen")) notFound();
  const items = await kitchenDishes(db, organizationId, currency, p.start, p.through);
  return (
    <>
      <ReportTabs current="dishes" kitchen />
      <div className="page-heading day-heading report-heading">
        <h1>Блюда за {monthWord(p.start)}</h1>
        <MonthNav base="/reports/dishes" offset={offset} today={today} />
      </div>
      {items.length ? (
        <DishReport items={items} currency={currency} />
      ) : (
        <div className="empty">
          <h2>Продаж за этот месяц нет</h2>
          <p>Записывайте «Продажи за день» - здесь появится, какие блюда приносят больше денег.</p>
        </div>
      )}
    </>
  );
}
