import Link from "next/link";
import { getContext } from "@/lib/context";
import { ProductForm } from "@/components/product-form";
import { STOCK_ERROR_TEXT } from "@/lib/stock";
import { loadCategories } from "@/lib/category-data";
import { variantAxes, variantAxisField } from "@/lib/business";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string; kind?: string }>;
}) {
  const { error, added, kind } = await searchParams;
  const { db, organizationId, currency, modules, business } = await getContext();
  const { categories, hints } = await loadCategories(db, organizationId);
  // «Добавить и ещё один»: показываем, что прошлый сохранился (товар или модель с размерами).
  const model = kind === "model";
  const last =
    added && /^[a-f0-9-]{36}$/i.test(added)
      ? (await db.from(model ? "product_models" : "products").select("id,name").eq("organization_id", organizationId).eq("id", added).maybeSingle())
          .data
      : null;
  // Одежда и обувь (модуль «variants»): в той же форме — размеры и цвета.
  const axes = modules.includes("variants") ? variantAxes(business).map((key) => variantAxisField(key)) : undefined;
  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СКЛАД</span>
          <h1>Новый товар</h1>
        </div>
      </div>
      {last && (
        <p className="notice success" role="status">
          Добавлен: <Link href={model ? `/stock/model/${last.id}` : `/stock/${last.id}`}>{last.name}</Link>. Следующий:
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save}
        </p>
      )}
      <section className="panel">
        {/* key — форма пустая после «Добавить и ещё один». */}
        <ProductForm key={added ?? "new"} currency={currency} categories={categories} hints={hints} variantAxes={axes} />
      </section>
    </>
  );
}
