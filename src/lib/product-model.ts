/**
 * Модель товара с размерами и цветами (миграция 20261029100000): оси и их
 * значения, сочетания и названия товаров. Сама база проверяет то же и
 * называет товары так же — здесь для формы и показа.
 */
export type ModelAxis = { key: string; values: string[] };
export type VariantAttrs = Record<string, string>;

/** Лимиты как в save_product_model. */
export const MODEL_LIMITS = { axes: 3, values: 40, valueLength: 30, name: 100, rows: 300 } as const;

/** Значение оси: без лишних пробелов, до 30 знаков. */
export const axisValue = (raw: string) => raw.replace(/\s+/g, " ").trim().slice(0, MODEL_LIMITS.valueLength);

/** Добавить значения к оси: «S, M; L» — по одному, без повторов (регистр не важен). */
export function addAxisValues(values: readonly string[], raw: string): string[] {
  const out = [...values];
  for (const part of raw.split(/[,;\n]/)) {
    const value = axisValue(part);
    if (value && !out.some((v) => v.toLowerCase() === value.toLowerCase()) && out.length < MODEL_LIMITS.values) out.push(value);
  }
  return out;
}

/** Все сочетания осей по порядку: первая ось меняется медленнее. */
export function combinations(axes: readonly ModelAxis[]): VariantAttrs[] {
  return axes.reduce<VariantAttrs[]>(
    (all, axis) => all.flatMap((attrs) => axis.values.map((value) => ({ ...attrs, [axis.key]: value }))),
    axes.length ? [{}] : [],
  );
}

/** Одно сочетание — одна строка ключа (для сравнения и полей формы). */
export const attrsKey = (axes: readonly ModelAxis[], attrs: VariantAttrs) => axes.map((a) => attrs[a.key] ?? "").join("\u0001");

/** «Футболка Nike (M, Чёрный)» — так база называет товар модели. */
export const variantName = (name: string, axes: readonly ModelAxis[], attrs: VariantAttrs) =>
  `${name} (${axes.map((a) => attrs[a.key]).join(", ")})`;

/** Оси из базы (product_models.axes); мусор — пустой список. */
export function parseAxes(value: unknown): ModelAxis[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) =>
    a && typeof a === "object" && typeof a.key === "string" && Array.isArray(a.values)
      ? [{ key: a.key, values: a.values.filter((v: unknown): v is string => typeof v === "string") }]
      : [],
  );
}

/** Модель: название и оси с вариантами по порядку (product_models). */
export type ModelInfo = { id: string; name: string; axes: ModelAxis[] };

/** Товар модели: какая модель и какой он размер/цвет. */
export type VariantOf = { model: string; attrs: VariantAttrs };

/** «S, Чёрный» — размер и цвет товара модели. */
export const variantLabel = (axes: readonly ModelAxis[], attrs: VariantAttrs | null | undefined) =>
  axes.map((a) => attrs?.[a.key]).filter(Boolean).join(", ");

/**
 * Товары модели по порядку её осей: S, M, L — как в модели, а не по
 * алфавиту (L, M, S). Значение, которого в модели нет, — в конце.
 */
export function sortVariants<T>(items: readonly T[], axes: readonly ModelAxis[], attrsOf: (item: T) => VariantAttrs | null | undefined): T[] {
  const rank = (item: T) =>
    axes.map((a) => {
      const i = a.values.indexOf(attrsOf(item)?.[a.key] ?? "");
      return i < 0 ? a.values.length : i;
    });
  // Цвет (вторая ось) — главнее: «Чёрный: S, M, L», потом «Белый: S, M, L».
  const order = (r: number[]) => [...r.slice(1), r[0]];
  return [...items].sort((x, y) => {
    const a = order(rank(x)),
      b = order(rank(y));
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  });
}

export type Grouped<T> = { kind: "item"; item: T } | { kind: "model"; model: string; items: T[] };

/**
 * Список с товарами моделей, собранными в одну запись на месте первого из
 * них; остальные — как были. Порядок не меняется.
 */
export function groupByModel<T>(items: readonly T[], modelOf: (item: T) => string | null | undefined): Grouped<T>[] {
  const out: Grouped<T>[] = [];
  const groups = new Map<string, { kind: "model"; model: string; items: T[] }>();
  for (const item of items) {
    const model = modelOf(item);
    if (!model) {
      out.push({ kind: "item", item });
      continue;
    }
    const group = groups.get(model);
    if (group) group.items.push(item);
    else {
      const created = { kind: "model" as const, model, items: [item] };
      groups.set(model, created);
      out.push(created);
    }
  }
  return out;
}
