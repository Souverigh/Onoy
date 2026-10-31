import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { period } from "@/lib/periods";
import { kitchenProducts } from "@/lib/kitchen-report";
import { ReportTabs } from "@/components/report-tabs";
import { MonthNav, ProductReport, monthWord } from "@/components/kitchen-report";

/** Отчёты → «Продукты» (модуль «kitchen»): сколько ушло, что закупили, что подорожало. */
export default async function ProductsReport({ searchParams }: { searchParams: Promise<{ offset?: string }> }) {
  const params = await searchParams;
  const offset = Math.min(0, Math.max(-120, parseInt(params.offset ?? "0") || 0));
  const today = bishkekDate();
  const p = period("month", today, offset);
  const { db, organizationId, currency, modules } = await requireOwner();
  if (!modules.includes("kitchen")) notFound();
  const { products, rises } = await kitchenProducts(db, organizationId, currency, p.start, p.through);
  return (
    <>
      <ReportTabs current="products" kitchen />
      <div className="page-heading day-heading report-heading">
        <h1>Продукты за {monthWord(p.start)}</h1>
        <MonthNav base="/reports/products" offset={offset} today={today} />
      </div>
      {products.length || rises.length ? (
        <ProductReport products={products} rises={rises} currency={currency} />
      ) : (
        <div className="empty">
          <h2>За этот месяц продукты не расходовались</h2>
          <p>Записывайте «Продажи за день» и «Закупку продуктов» - здесь будет видно, сколько ушло и что подорожало.</p>
        </div>
      )}
    </>
  );
}
