import Link from "next/link";
import { getContext } from "@/lib/context";
import { ProductForm } from "@/components/product-form";
import { STOCK_ERROR_TEXT } from "@/lib/stock";
import { loadCategories } from "@/lib/category-data";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { error, added } = await searchParams;
  const { db, organizationId, currency, modules } = await getContext();
  // «Добавить и ещё один»: показываем, что прошлый сохранился.
  const { categories, hints } = await loadCategories(db, organizationId);
  const last =
    added && /^[a-f0-9-]{36}$/i.test(added)
      ? (await db.from("products").select("id,name").eq("organization_id", organizationId).eq("id", added).maybeSingle()).data
      : null;
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
        {/* Одежда и обувь (модуль «variants»): одна модель — все размеры и цвета. */}
        {modules.includes("variants") && (
          <div className="page-heading-actions">
            <Link className="button" href="/stock/model/new">
              С размерами и цветами
            </Link>
          </div>
        )}
      </div>
      {last && (
        <p className="notice success" role="status">
          Добавлен: <Link href={`/stock/${last.id}`}>{last.name}</Link>. Следующий:
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save}
        </p>
      )}
      <section className="panel">
        {/* key — форма пустая после «Добавить и ещё один». */}
        <ProductForm key={added ?? "new"} currency={currency} categories={categories} hints={hints} />
      </section>
    </>
  );
}
