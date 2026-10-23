"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyCategoryGroups, setProductsCategory, type CategoryActionResult } from "@/app/(workspace)/stock/categories/actions";
import { CATEGORY_ERROR_TEXT, type CategoryGroup } from "@/lib/category";

export type CategorySuggestion = { id: string; name: string; category: string; label: string };

/** Сколько строк подсказок показывать сразу. */
const SHOWN = 50;

/**
 * Помощник категорий: новые категории, собранные по названиям товаров, и
 * подсказки «в какую из ваших категорий». Ничего не ставится само — только
 * то, что человек отметил или нажал.
 */
export function CategoryHelper({ groups, suggestions }: { groups: CategoryGroup[]; suggestions: CategorySuggestion[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picked, setPicked] = useState(() => new Set(groups.map((g) => g.key)));
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.key, g.name])));
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function finish(result: CategoryActionResult, ok: string) {
    if ("error" in result) setMessage({ ok: false, text: CATEGORY_ERROR_TEXT[result.error] ?? CATEGORY_ERROR_TEXT.save });
    else {
      setMessage({ ok: true, text: ok });
      router.refresh();
    }
  }

  function createGroups() {
    const chosen = groups
      .filter((g) => picked.has(g.key) && (names[g.key] ?? "").trim())
      .map((g) => ({ name: names[g.key].trim(), products: g.products.map((p) => p.id) }));
    if (!chosen.length) return;
    start(async () => finish(await applyCategoryGroups(chosen), `Готово: создано категорий - ${chosen.length}.`));
  }

  function acceptOne(s: CategorySuggestion) {
    setDone((d) => new Set(d).add(s.id));
    start(async () => {
      const result = await setProductsCategory([s.id], s.category);
      if ("error" in result) {
        setDone((d) => {
          const next = new Set(d);
          next.delete(s.id);
          return next;
        });
      }
      finish(result, `«${s.name}» - в «${s.label}».`);
    });
  }

  function acceptAll() {
    const left = suggestions.filter((s) => !done.has(s.id));
    const byCategory = new Map<string, string[]>();
    for (const s of left) byCategory.set(s.category, [...(byCategory.get(s.category) ?? []), s.id]);
    start(async () => {
      let result: CategoryActionResult = { changed: 0 };
      for (const [category, ids] of byCategory) {
        result = await setProductsCategory(ids, category);
        if ("error" in result) break;
      }
      finish(result, `Готово: разложено товаров - ${left.length}.`);
    });
  }

  const left = suggestions.filter((s) => !done.has(s.id));
  const chosenCount = groups.filter((g) => picked.has(g.key)).length;

  return (
    <div className="category-helper">
      {message && (
        <p className={message.ok ? "notice success" : "form-error"} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}

      {groups.length > 0 && (
        <section>
          <div className="section-title">
            <h2>Предлагаем категории</h2>
            <span className="muted">по названиям товаров</span>
          </div>
          <p className="muted">
            Отметьте нужные и при необходимости поправьте название - товары сразу попадут в категорию. Подкатегории
            можно добавить потом.
          </p>
          <ul className="category-groups">
            {groups.map((g) => (
              <li key={g.key}>
                <input
                  type="checkbox"
                  checked={picked.has(g.key)}
                  aria-label={`Создать категорию: ${names[g.key]}`}
                  onChange={(e) =>
                    setPicked((current) => {
                      const next = new Set(current);
                      if (e.target.checked) next.add(g.key);
                      else next.delete(g.key);
                      return next;
                    })
                  }
                />
                <span className="category-group-text">
                  <input
                    value={names[g.key] ?? ""}
                    maxLength={60}
                    aria-label="Название категории"
                    onChange={(e) => setNames((n) => ({ ...n, [g.key]: e.target.value }))}
                  />
                  <small className="muted">
                    {g.products.length} тов.: {g.products.slice(0, 3).map((p) => p.name).join(", ")}
                    {g.products.length > 3 ? "…" : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="button primary" disabled={pending || !chosenCount} onClick={createGroups}>
            {pending ? "Сохраняем…" : `Создать категории: ${chosenCount}`}
          </button>
        </section>
      )}

      {left.length > 0 && (
        <section>
          <div className="section-title">
            <h2>Разложить по вашим категориям</h2>
            <span className="muted">{left.length} тов.</span>
          </div>
          <p className="muted">Нажмите на категорию - товар попадёт в неё.</p>
          <ul className="category-suggestions">
            {left.slice(0, SHOWN).map((s) => (
              <li key={s.id}>
                <span>{s.name}</span>
                <button
                  type="button"
                  className="category-chip"
                  disabled={pending}
                  aria-label={`Поставить «${s.name}» в категорию «${s.label}»`}
                  onClick={() => acceptOne(s)}
                >
                  + {s.label}
                </button>
              </li>
            ))}
          </ul>
          {left.length > SHOWN && <p className="muted">Показаны первые {SHOWN}.</p>}
          {left.length > 1 && (
            <button type="button" className="button" disabled={pending} onClick={acceptAll}>
              Разложить все: {left.length}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Подсказка в списке склада: нажали — категория поставлена. */
export function CategoryChip({ productId, categoryId, label }: { productId: string; categoryId: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      className="category-chip"
      disabled={pending}
      title={failed ? "Не удалось сохранить - попробуйте ещё раз" : "Поставить эту категорию"}
      aria-label={`Поставить категорию «${label}»`}
      onClick={() =>
        start(async () => {
          const result = await setProductsCategory([productId], categoryId);
          setFailed("error" in result);
          if (!("error" in result)) router.refresh();
        })
      }
    >
      {pending ? "…" : failed ? `Ещё раз: ${label}` : `+ ${label}`}
    </button>
  );
}
