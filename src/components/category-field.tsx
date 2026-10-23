"use client";

import { useEffect, useRef, useState } from "react";
import { categoryLabel, categoryTree, suggestCategory, type Category } from "@/lib/category";

const NEW = "__new";

/**
 * Категория в форме товара: выбор из своих, «+ Новая категория» и подсказка
 * по названию («Подходит: Светильники») — нажали, и она выбрана. Значения
 * формы: category_id, new_category, new_category_parent (см. saveProduct).
 */
export function CategoryField({
  categories,
  hints,
  initial,
}: {
  categories: Category[];
  hints: Record<string, string>;
  initial: string | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [name, setName] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const tree = categoryTree(categories);

  // Название товара — из поля «Название» этой же формы, по мере ввода.
  useEffect(() => {
    const input = box.current?.closest("form")?.querySelector<HTMLInputElement>('input[name="name"]');
    if (!input) return;
    const read = () => setName(input.value);
    read();
    input.addEventListener("input", read);
    return () => input.removeEventListener("input", read);
  }, []);

  const hint = value === "" ? suggestCategory(name, hints) : null;
  const hintLabel = categoryLabel(categories, hint);

  return (
    <div className="category-field" ref={box}>
      <input type="hidden" name="category_field" value="1" />
      <label>
        Категория
        <select name="category_id" value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Без категории</option>
          {tree.map(({ category, children }) => [
            <option key={category.id} value={category.id}>
              {category.name}
            </option>,
            ...children.map((c) => (
              <option key={c.id} value={c.id}>
                {category.name} / {c.name}
              </option>
            )),
          ])}
          <option value={NEW}>+ Новая категория…</option>
        </select>
      </label>
      {hint && hintLabel && (
        <p className="category-field-hint">
          <span className="muted">Подходит:</span>
          <button type="button" className="category-chip" onClick={() => setValue(hint)}>
            + {hintLabel}
          </button>
        </p>
      )}
      {value === NEW && (
        <div className="form-grid">
          <label>
            Название новой категории
            <input name="new_category" maxLength={60} required autoFocus placeholder="Например, Освещение" />
          </label>
          {tree.length > 0 && (
            <label>
              Где
              <select name="new_category_parent" defaultValue="">
                <option value="">Отдельная категория</option>
                {tree.map(({ category }) => (
                  <option key={category.id} value={category.id}>
                    Подкатегория в «{category.name}»
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
