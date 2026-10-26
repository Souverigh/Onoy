import Link from "next/link";
import { getContext } from "@/lib/context";
import { ModelForm } from "@/components/model-form";
import { STOCK_ERROR_TEXT } from "@/lib/stock";
import { loadCategories } from "@/lib/category-data";
import { VARIANT_AXES, variantAxes } from "@/lib/business";

/** Новая модель с размерами и цветами (модуль «variants», src/lib/business.ts). */
export default async function NewModelPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { db, organizationId, currency, business } = await getContext();
  const { categories, hints } = await loadCategories(db, organizationId);
  const axes = variantAxes(business).map((key) => ({ key, values: [], ...VARIANT_AXES[key] }));
  return (
    <>
      <Link className="back-link" href="/stock/new">
        ← Обычный товар
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СКЛАД</span>
          <h1>Товар с размерами и цветами</h1>
          <p className="muted">Каждый размер и цвет станет отдельным товаром со своим остатком - продавать как обычно.</p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {STOCK_ERROR_TEXT[error] ?? STOCK_ERROR_TEXT.save}
        </p>
      )}
      <section className="panel">
        <ModelForm axes={axes} currency={currency} categories={categories} hints={hints} />
      </section>
    </>
  );
}
