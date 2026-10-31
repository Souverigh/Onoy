import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { DishForm } from "@/components/dish-form";
import { DISH_ERROR_TEXT } from "@/lib/dish";
import { kitchenProducts, menuCategories } from "@/lib/dish-data";

/** Новое блюдо меню (модуль «kitchen»). */
export default async function NewDishPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { db, organizationId, currency, modules } = await getContext();
  if (!modules.includes("kitchen")) notFound();
  const [products, categories] = await Promise.all([kitchenProducts(db, organizationId), menuCategories(db, organizationId)]);
  return (
    <>
      <Link className="back-link" href="/menu">
        ← Меню
      </Link>
      <div className="page-heading">
        <h1>Новое блюдо</h1>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {DISH_ERROR_TEXT[error] ?? DISH_ERROR_TEXT.save}
        </p>
      )}
      <DishForm products={products} categories={categories} currency={currency} />
    </>
  );
}
