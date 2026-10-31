import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { DishForm } from "@/components/dish-form";
import { Submit } from "@/components/submit";
import { DISH_ERROR_TEXT } from "@/lib/dish";
import { loadMenu, menuCategories } from "@/lib/dish-data";
import { archiveDish } from "../actions";

/** Блюдо меню: состав, цена, в архив и обратно. */
export default async function DishPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const { id } = await params;
  const { error } = await searchParams;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId, currency, modules } = await getContext();
  if (!modules.includes("kitchen")) notFound();
  const [{ dishes, products, archivedProducts }, categories] = await Promise.all([
    loadMenu(db, organizationId, currency, { id }),
    menuCategories(db, organizationId),
  ]);
  const dish = dishes[0];
  if (!dish) notFound();
  return (
    <>
      <Link className="back-link" href={dish.archived ? "/menu?archived=1" : "/menu"}>
        ← {dish.archived ? "Архив меню" : "Меню"}
      </Link>
      <div className="page-heading">
        <h1>{dish.name}</h1>
        <form action={archiveDish} className="page-heading-actions">
          <input type="hidden" name="id" value={dish.id} />
          <input type="hidden" name="archived" value={dish.archived ? "false" : "true"} />
          {dish.archived ? <Submit>Вернуть в меню</Submit> : <button className="button" type="submit">В архив</button>}
        </form>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {DISH_ERROR_TEXT[error] ?? DISH_ERROR_TEXT.save}
        </p>
      )}
      {dish.archived ? (
        <p className="notice">Блюдо в архиве - его больше не готовят. Верните в меню, чтобы изменить.</p>
      ) : (
        <DishForm key={dish.id} dish={dish} products={[...products, ...archivedProducts]} categories={categories} currency={currency} />
      )}
    </>
  );
}
