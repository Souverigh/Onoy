import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { DAY_SALE_ERROR_TEXT } from "@/lib/day-sale";
import { loadMenu } from "@/lib/dish-data";
import { DaySalesForm, type DaySaleGood, type DaySaleStock } from "@/components/day-sales-form";

/**
 * «Продажи за день» кафе (модуль «kitchen»): блюда меню и товары склада с
 * ценой продажи. День уже записан — сразу его запись.
 */
export default async function DaySalesPage({ searchParams }: { searchParams: Promise<{ date?: string; error?: string }> }) {
  const params = await searchParams;
  const { db, organizationId, currency, modules } = await getContext();
  if (!modules.includes("kitchen")) notFound();
  const today = bishkekDate();
  const date = params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today;

  const existing = await db
    .from("day_sales")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("sale_date", date)
    .is("reversed_at", null)
    .maybeSingle();
  if (existing.data) redirect(`/day-sales/${existing.data.id}`);

  const [{ dishes }, balances] = await Promise.all([
    loadMenu(db, organizationId, currency),
    db
      .from("product_balances")
      .select("id,name,unit,sale_price,purchase_price,purchase_currency,stock")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("name")
      .range(0, 4999),
  ]);
  if (balances.error) throw new Error("Не удалось загрузить склад");
  const products = (balances.data ?? []) as {
    id: string;
    name: string;
    unit: string;
    sale_price: string;
    purchase_price: string;
    purchase_currency: string | null;
    stock: string;
  }[];
  // Товары «как есть» (Fanta, нан) — те, что продаются: с ценой продажи. Продукты для готовки её обычно не имеют.
  const goods: DaySaleGood[] = products
    .filter((p) => Number(p.sale_price) > 0)
    .map((p) => ({ id: p.id, name: p.name, unit: p.unit, price: p.sale_price, stock: p.stock }));
  const stock: Record<string, DaySaleStock> = Object.fromEntries(
    products.map((p) => [p.id, { name: p.name, unit: p.unit, stock: p.stock, purchase_price: p.purchase_price, purchase_currency: p.purchase_currency }]),
  );

  return (
    <>
      {params.error && (
        <p className="form-error" role="alert">
          {DAY_SALE_ERROR_TEXT[params.error] ?? DAY_SALE_ERROR_TEXT.save}
        </p>
      )}
      {!dishes.length && (
        <p className="notice">
          В меню пока нет блюд. <Link href="/menu/new">Добавьте блюда</Link> - тогда продукты будут списываться сами.
        </p>
      )}
      <DaySalesForm
        key={date}
        date={date}
        today={today}
        dishes={dishes.map((d) => ({ id: d.id, name: d.name, price: d.price, category: d.category, recipe: d.lines }))}
        goods={goods}
        stock={stock}
        currency={currency}
      />
    </>
  );
}
