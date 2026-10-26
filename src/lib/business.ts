/**
 * Модули Depter — части, которые включаются под вид бизнеса (PRESETS ниже).
 * Ядро (клиенты, поставщики, долги, продажи, оплаты, отчёты, документы) есть
 * у всех и сюда не входит.
 *
 * Новый модуль: запись здесь, своя папка src/app/(workspace)/<модуль>/ и свои
 * таблицы; в меню — пункт с этим id (shell.tsx). Ядро о модуле не знает.
 * Выключенный модуль только прячет раздел — данные остаются.
 */
export const MODULES = {
  stock: {
    label: "Склад",
    description: "Товары, остатки, продажа и приход товарами.",
  },
  catalog: {
    label: "Каталог и заказы",
    description: "Ссылка на каталог для клиентов и их заказы в разделе «Заказы».",
  },
} as const;

export type ModuleId = keyof typeof MODULES;

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[];

export const isModuleId = (value: string): value is ModuleId => Object.hasOwn(MODULES, value);

/**
 * Виды бизнеса: какие модули включены и как называются разделы. Новый вид —
 * одна запись здесь, без миграции (в базе — только id вида, см.
 * 20261028100000_business_profile.sql). Вид, которого этот код не знает
 * (база новее кода), и пустой вид — «Магазин», как было до видов бизнеса.
 */
export type Preset = {
  label: string;
  modules: readonly ModuleId[];
  /** Названия разделов меню вместо обычных (ключ — адрес раздела). */
  navLabels?: Readonly<Record<string, string>>;
};

export const PRESETS = {
  shop: { label: "Магазин", modules: ["stock", "catalog"] },
  grocery: { label: "Продуктовый магазин", modules: ["stock", "catalog"] },
  clothing: { label: "Одежда и обувь", modules: ["stock", "catalog"] },
  clothing_rental: { label: "Прокат одежды", modules: ["stock", "catalog"], navLabels: { "/stock": "Вещи" } },
  restaurant: { label: "Кафе, ресторан", modules: ["stock"], navLabels: { "/stock": "Продукты" } },
  other: { label: "Другое", modules: ["stock", "catalog"] },
} as const satisfies Record<string, Preset>;

export type BusinessType = keyof typeof PRESETS;

export const DEFAULT_BUSINESS: BusinessType = "shop";

export const BUSINESS_TYPES = Object.keys(PRESETS) as BusinessType[];

export const isBusinessType = (value: unknown): value is BusinessType =>
  typeof value === "string" && Object.hasOwn(PRESETS, value);

/** Вид из базы: null и незнакомый — «Магазин». */
export const businessType = (value: unknown): BusinessType => (isBusinessType(value) ? value : DEFAULT_BUSINESS);

/** Что видит магазин: модули вида с поправками владельца ('+id' / '-id'). */
export function resolveModules(type: unknown, overrides: readonly string[] | null | undefined): ModuleId[] {
  const on = new Set<ModuleId>(PRESETS[businessType(type)].modules);
  for (const o of overrides ?? []) {
    const id = o.slice(1);
    if (!isModuleId(id)) continue;
    if (o[0] === "+") on.add(id);
    else if (o[0] === "-") on.delete(id);
  }
  return MODULE_IDS.filter((id) => on.has(id));
}

/** Поправки к виду, чтобы получить выбранные модули (пусто — ровно по виду). */
export function moduleOverrides(type: BusinessType, chosen: readonly ModuleId[]): string[] {
  const base = new Set<ModuleId>(PRESETS[type].modules);
  const want = new Set(chosen);
  return MODULE_IDS.flatMap((id) => (want.has(id) && !base.has(id) ? [`+${id}`] : !want.has(id) && base.has(id) ? [`-${id}`] : []));
}

/** Название раздела меню для вида бизнеса. */
export const navLabel = (type: BusinessType, href: string, label: string) =>
  (PRESETS[type] as Preset).navLabels?.[href] ?? label;
