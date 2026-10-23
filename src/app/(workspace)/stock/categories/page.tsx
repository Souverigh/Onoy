import Link from "next/link";
import { getContext } from "@/lib/context";
import { loadCategories } from "@/lib/category-data";
import { CATEGORY_ERROR_TEXT, categoryGroups, categoryLabel, categoryTree, suggestCategory, type Category } from "@/lib/category";
import { CategoryHelper, type CategorySuggestion } from "@/components/category-helper";
import { ConfirmButton } from "@/components/confirm-button";
import { Submit } from "@/components/submit";
import { deleteCategory, saveCategory } from "./actions";

const SAVED_TEXT: Record<string, string> = {
  created: "Категория добавлена.",
  renamed: "Название сохранено.",
  deleted: "Категория удалена - товары остались на складе.",
};

/**
 * Категории товаров (просьба пользователя 23.10.2026): категории и
 * подкатегории магазина и помощник — категории по названиям товаров.
 */
export default async function CategoriesPage({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const { saved, error } = await searchParams;
  const { db, organizationId, isOwner } = await getContext();
  const { categories, products, hints } = await loadCategories(db, organizationId);
  const tree = categoryTree(categories);
  const count = new Map<string, number>();
  for (const p of products) if (p.category_id) count.set(p.category_id, (count.get(p.category_id) ?? 0) + 1);
  const total = (c: Category) =>
    (count.get(c.id) ?? 0) + categories.filter((x) => x.parent_id === c.id).reduce((s, x) => s + (count.get(x.id) ?? 0), 0);
  const without = products.filter((p) => !p.category_id);
  const suggestions: CategorySuggestion[] = without.flatMap((p) => {
    const category = suggestCategory(p.name, hints);
    const label = categoryLabel(categories, category);
    return category && label ? [{ id: p.id, name: p.name, category, label }] : [];
  });
  const groups = categoryGroups(products, hints).filter(
    // Имя уже занято категорией верхнего уровня — такие товары и так получат подсказку.
    (g) => !categories.some((c) => !c.parent_id && c.name.toLowerCase() === g.name.toLowerCase()),
  );

  const renameForm = (c: Category) => (
    <form action={saveCategory} className="category-inline-form">
      <input type="hidden" name="id" value={c.id} />
      <label className="sr-only" htmlFor={`rename-${c.id}`}>
        Новое название
      </label>
      <input id={`rename-${c.id}`} name="name" defaultValue={c.name} maxLength={60} required />
      <Submit>Сохранить</Submit>
    </form>
  );
  const deleteForm = (c: Category, sub: boolean) =>
    isOwner && (
      <form action={deleteCategory}>
        <input type="hidden" name="id" value={c.id} />
        <ConfirmButton
          className="text-button danger-text"
          message={`Удалить категорию «${c.name}»?`}
          text={
            sub
              ? "Товары из неё останутся на складе и перейдут в верхнюю категорию."
              : "Товары останутся на складе - без категории. Подкатегории удалятся вместе с ней."
          }
          confirmLabel="Удалить"
        >
          Удалить категорию
        </ConfirmButton>
      </form>
    );

  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СКЛАД</span>
          <h1>Категории товаров</h1>
          <p className="muted">
            По категориям удобнее искать на складе, а клиенты выбирают их в каталоге. Товар без категории попадает в
            «Без категории».
          </p>
        </div>
      </div>
      {saved && SAVED_TEXT[saved] && (
        <p className="notice success" role="status">
          {SAVED_TEXT[saved]}
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {CATEGORY_ERROR_TEXT[error] ?? CATEGORY_ERROR_TEXT.save}
        </p>
      )}

      {(groups.length > 0 || suggestions.length > 0) && (
        <section className="panel">
          <CategoryHelper groups={groups} suggestions={suggestions} />
        </section>
      )}

      <section className="panel">
        <div className="section-title">
          <h2>Ваши категории</h2>
          {without.length > 0 && <Link href="/stock?category=none">Без категории: {without.length} →</Link>}
        </div>
        <form action={saveCategory} className="category-inline-form">
          <label className="sr-only" htmlFor="new-category">
            Новая категория
          </label>
          <input id="new-category" name="name" maxLength={60} required placeholder="Новая категория, например «Освещение»" />
          <Submit>Добавить</Submit>
        </form>
        {tree.length ? (
          <ul className="category-tree">
            {tree.map(({ category, children }) => (
              <li key={category.id}>
                <details>
                  <summary>
                    <strong>{category.name}</strong>
                    <span className="muted">{total(category)} тов.</span>
                  </summary>
                  <div className="category-edit">
                    {renameForm(category)}
                    <form action={saveCategory} className="category-inline-form">
                      <input type="hidden" name="parent" value={category.id} />
                      <label className="sr-only" htmlFor={`sub-${category.id}`}>
                        Новая подкатегория
                      </label>
                      <input id={`sub-${category.id}`} name="name" maxLength={60} required placeholder="Подкатегория" />
                      <Submit>+ Подкатегория</Submit>
                    </form>
                    <div className="category-edit-links">
                      <Link className="text-button" href={`/stock?category=${category.id}`}>
                        Товары категории →
                      </Link>
                      {deleteForm(category, false)}
                    </div>
                  </div>
                </details>
                {children.length > 0 && (
                  <ul className="category-tree-children">
                    {children.map((child) => (
                      <li key={child.id}>
                        <details>
                          <summary>
                            <span>{child.name}</span>
                            <span className="muted">{count.get(child.id) ?? 0} тов.</span>
                          </summary>
                          <div className="category-edit">
                            {renameForm(child)}
                            <div className="category-edit-links">
                              <Link className="text-button" href={`/stock?category=${child.id}`}>
                                Товары подкатегории →
                              </Link>
                              {deleteForm(child, true)}
                            </div>
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            Категорий пока нет. {groups.length ? "Выберите предложенные выше или добавьте свою." : "Добавьте первую."}
          </p>
        )}
      </section>
    </>
  );
}
