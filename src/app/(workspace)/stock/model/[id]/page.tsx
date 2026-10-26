import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { ModelForm, type ModelVariant } from "@/components/model-form";
import { STOCK_ERROR_TEXT } from "@/lib/stock";
import { VARIANT_AXES } from "@/lib/business";
import { parseAxes, type VariantAttrs } from "@/lib/product-model";

const AXIS_TEXT: Record<string, { label: string; suggest: readonly string[] }> = VARIANT_AXES;

/** Модель: остатки по размерам и цветам, новые сочетания, цены всем сразу. */
export default async function ModelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, currency } = await getContext();
  const [modelResult, productsResult] = await Promise.all([
    db.from("product_models").select("id,name,axes").eq("organization_id", organizationId).eq("id", id).maybeSingle(),
    db
      .from("products")
      .select("id,variant_attrs,archived_at,sale_price,purchase_price,purchase_currency")
      .eq("organization_id", organizationId)
      .eq("model_id", id),
  ]);
  if (modelResult.error || productsResult.error) throw new Error("Не удалось загрузить модель");
  const model = modelResult.data as { id: string; name: string; axes: unknown } | null;
  if (!model) notFound();
  const products = (productsResult.data ?? []) as {
    id: string;
    variant_attrs: VariantAttrs | null;
    archived_at: string | null;
    sale_price: string;
    purchase_price: string;
    purchase_currency: string | null;
  }[];
  const balances = products.length
    ? await db.from("product_balances").select("id,stock").eq("organization_id", organizationId).in(
        "id",
        products.map((p) => p.id),
      )
    : null;
  const stock = new Map(((balances?.data ?? []) as { id: string; stock: string }[]).map((b) => [b.id, b.stock]));
  const variants: ModelVariant[] = products.map((p) => ({
    id: p.id,
    attrs: p.variant_attrs ?? {},
    stock: stock.get(p.id) ?? "0",
    archived: Boolean(p.archived_at),
  }));
  const axes = parseAxes(model.axes).map((a) => ({
    ...a,
    label: AXIS_TEXT[a.key]?.label ?? a.key,
    suggest: AXIS_TEXT[a.key]?.suggest ?? [],
  }));
  const priced = products.find((p) => !p.archived_at) ?? products[0];
  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">МОДЕЛЬ · {variants.filter((v) => !v.archived).length} ТОВ.</span>
          <h1>{model.name}</h1>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Сохранено.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save}
        </p>
      )}
      <section className="panel">
        <ModelForm
          key={variants.length}
          model={{ id: model.id, name: model.name }}
          axes={axes}
          variants={variants}
          prices={
            priced
              ? { sale: priced.sale_price, purchase: priced.purchase_price, purchaseCurrency: priced.purchase_currency }
              : undefined
          }
          currency={currency}
          categories={[]}
          hints={{}}
        />
      </section>
    </>
  );
}
