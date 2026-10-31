import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { normalizeText } from "@/lib/match";
import { loadMenu } from "@/lib/dish-data";
import { MenuStats, MenuTable } from "@/components/menu-table";

/**
 * Меню кафе (модуль «kitchen», макет 31.10.2026): блюда по категориям —
 * цена, продукты на порцию, заработок и доля продуктов. На компьютере —
 * таблица со сводкой сверху, на телефоне — список карточек.
 */
export default async function MenuPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; archived?: string; saved?: string; archived_one?: string }>;
}) {
  const params = await searchParams;
  const { db, organizationId, currency, modules } = await getContext();
  if (!modules.includes("kitchen")) notFound();
  const archived = params.archived === "1";
  const [{ dishes }, archivedCount] = await Promise.all([
    loadMenu(db, organizationId, currency, { archived }),
    archived
      ? Promise.resolve(0)
      : db
          .from("dishes")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .not("archived_at", "is", null)
          .then((r) => r.count ?? 0),
  ]);
  const q = normalizeText(params.q ?? "");
  const shown = q ? dishes.filter((d) => normalizeText(d.name).includes(q)) : dishes;
  const saved = params.saved ? dishes.find((d) => d.id === params.saved) : null;

  return (
    <>
      <div className="page-heading menu-heading">
        <h1>{archived ? "Архив меню" : "Меню"}</h1>
        <div className="page-heading-actions">
          <form className="doc-search menu-search" action="/menu" role="search">
            {archived && <input type="hidden" name="archived" value="1" />}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
            </svg>
            <input name="q" type="search" defaultValue={params.q ?? ""} placeholder="Найти блюдо" aria-label="Найти блюдо" autoComplete="off" />
          </form>
          {!archived && (
            <Link className="button primary" href="/menu/new">
              + Блюдо
            </Link>
          )}
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Сохранено: {saved.name}.
        </p>
      )}
      {params.archived_one && (
        <p className="notice success" role="status">
          Блюдо убрано в архив.
        </p>
      )}

      {!archived && dishes.length > 0 && <MenuStats dishes={dishes} />}

      {shown.length > 0 ? (
        <MenuTable dishes={shown} currency={currency} />
      ) : (
        <div className="empty">
          <h2>{q ? "Ничего не нашлось" : archived ? "В архиве пусто" : "Меню пока пустое"}</h2>
          <p>
            {q
              ? "Попробуйте другое название."
              : archived
                ? "Сюда попадают блюда, которые больше не готовят."
                : "Добавьте блюдо и его состав из продуктов склада - Depter посчитает, сколько стоят продукты на порцию и сколько вы зарабатываете."}
          </p>
          {!q && !archived && (
            <Link className="button primary" href="/menu/new">
              + Блюдо
            </Link>
          )}
        </div>
      )}

      {archived ? (
        <Link className="text-button menu-archive-link" href="/menu">
          ← Меню
        </Link>
      ) : (
        archivedCount > 0 && (
          <Link className="text-button menu-archive-link" href="/menu?archived=1">
            Архив ({archivedCount})
          </Link>
        )
      )}
    </>
  );
}
