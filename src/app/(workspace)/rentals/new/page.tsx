import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { onHand } from "@/lib/rental-data";
import { loadVariants } from "@/lib/model-data";
import { groupByModel, sortVariants, variantLabel } from "@/lib/product-model";
import { RentalForm, type RentalGroup, type RentalThing } from "@/components/rental-form";
import type { PickerParty } from "@/components/party-picker";

/** «Выдать» (модуль «Прокат»): свободные вещи склада — остаток минус на руках. */
export default async function NewRentalPage({ searchParams }: { searchParams: Promise<{ party?: string }> }) {
  const { party } = await searchParams;
  const { db, organizationId, currency, modules } = await getContext();
  if (!modules.includes("rental")) notFound();
  const [customers, products, out, { variants, models }] = await Promise.all([
    db
      .from("customer_balances")
      .select("id,name,phone,aliases,balance,currency")
      .eq("organization_id", organizationId)
      .is("merged_into_id", null)
      .is("archived_at", null)
      .order("name")
      .range(0, 4999),
    db
      .from("product_balances")
      .select("id,name,sale_price,stock")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("name")
      .range(0, 4999),
    onHand(db, organizationId),
    loadVariants(db, organizationId),
  ]);
  if (customers.error || products.error) throw new Error("Не удалось подготовить форму");
  const things: RentalThing[] = ((products.data ?? []) as { id: string; name: string; sale_price: string; stock: string }[])
    .map((p) => {
      const v = variants[p.id];
      const model = v ? models[v.model] : undefined;
      return {
        id: p.id,
        name: p.name,
        size: model ? variantLabel(model.axes, v.attrs) || null : null,
        price: Number(p.sale_price) || 0,
        free: Math.floor(Number(p.stock)) - (out.get(p.id)?.count ?? 0),
      };
    })
    .filter((t) => t.free > 0);
  // Модель — одной карточкой с размерами по порядку модели (S, M, L), как в продаже.
  const groups: RentalGroup[] = groupByModel(things, (t) => (variants[t.id] && models[variants[t.id].model] ? variants[t.id].model : null)).map(
    (g) => {
      if (g.kind === "item") return { key: g.item.id, name: g.item.name, things: [{ ...g.item, size: null }] };
      const model = models[g.model];
      return { key: g.model, name: model.name, things: sortVariants(g.items, model.axes, (t) => variants[t.id]?.attrs) };
    },
  );

  return (
    <>
      <Link className="back-link" href="/rentals">
        ← Прокат
      </Link>
      <div className="page-heading">
        <div>
          <h1>Выдать</h1>
          <p className="muted">Цена за сутки - цена вещи на складе. Сумму можно поправить.</p>
        </div>
      </div>
      <section className="panel simple-operation-panel">
        {groups.length ? (
          <RentalForm
            customers={(customers.data ?? []) as PickerParty[]}
            groups={groups}
            shopCurrency={currency}
            initialParty={party && /^[0-9a-f-]{36}$/i.test(party) ? party : ""}
          />
        ) : (
          <p className="muted">
            Свободных вещей нет: всё на руках или склад пуст. <Link href="/stock/new">Добавить вещь</Link>
          </p>
        )}
      </section>
    </>
  );
}
