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
  // Каждый размер и цвет — отдельный товар со своим остатком (product_models).
  variants: {
    label: "Размеры и цвета",
    description: "Товар-модель с размерами и цветами: у каждого свой остаток.",
  },
  // Выдача вещей со склада на дни под залог (src/lib/rentals.ts).
  rental: {
    label: "Прокат",
    description: "Выдача вещей на несколько дней под залог: что на руках, до какого дня, возврат.",
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
  /** Оси модели (VARIANT_AXES) по порядку; нет — размер и цвет. */
  variantAxes?: readonly VariantAxisKey[];
  /** «Новый товар» сразу открывает форму с размерами и цветами (если модуль включён). */
  newProduct?: "model";
  /**
   * Кнопки на главной по порядку: первые две — крупные, остальные — строкой
   * ниже. Кнопка модуля, который выключен, пропускается. Нет — как у магазина.
   */
  quickActions?: readonly QuickActionId[];
  /** Главная кнопка внизу на телефоне (между «Клиентами» и «Отчётами»); нет — «Продажа». */
  mainAction?: QuickActionId;
  /** Свои слова вместо обычных (WORDS): «Закупка продуктов» у кафе. */
  words?: Partial<Record<WordKey, string>>;
  /** Адрес регистрации сразу под этот вид: depter.kg/start/<slug>. */
  slug: string;
};

/**
 * Кнопки главной и нижней панели. Ядро — у всех; кнопка модуля — только
 * когда модуль включён (иначе её нет, а главная кнопка — «Продажа»).
 */
export const QUICK_ACTIONS = {
  sales: { href: "/sales", label: "Продажи" },
  sale: { href: "/money/new?type=sale", label: "Продажа" },
  purchases: { href: "/purchases", word: "purchase" },
  payment_in: { href: "/money/new?type=payment&direction=incoming", label: "Клиент принёс деньги" },
  payment_out: { href: "/money/new?type=payment&direction=outgoing", label: "Я заплатил поставщику" },
  expense: { href: "/money/expense", label: "Расход" },
  rental_issue: { href: "/rentals/new", label: "Выдать", module: "rental" },
  rentals: { href: "/rentals", label: "На руках", module: "rental" },
} as const satisfies Record<string, { href: string; label?: string; word?: WordKey; module?: ModuleId }>;

export type QuickActionId = keyof typeof QUICK_ACTIONS;

/** Слова, которые вид бизнеса может назвать по-своему. */
export const WORDS = {
  purchase: "Товар от поставщика",
} as const;

export type WordKey = keyof typeof WORDS;

const DEFAULT_QUICK: readonly QuickActionId[] = ["sales", "purchases", "payment_in", "payment_out", "expense"];

/** Чем различаются товары одной модели и что подсказать к выбору. */
export const VARIANT_AXES = {
  size: {
    label: "Размеры",
    placeholder: "Выберите размеры",
    groups: [
      { label: "Буквенные", values: ["XS", "S", "M", "L", "XL", "XXL", "3XL"] },
      { label: "Цифровые", values: ["40", "42", "44", "46", "48", "50", "52", "54", "56"] },
      { label: "Обувь", values: ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"] },
    ],
  },
  color: {
    label: "Цвета",
    placeholder: "Без цвета",
    groups: [
      {
        label: "Цвета",
        values: ["Чёрный", "Белый", "Серый", "Синий", "Голубой", "Красный", "Зелёный", "Бежевый", "Коричневый", "Розовый", "Жёлтый"],
      },
    ],
  },
} as const;

export type VariantAxisKey = keyof typeof VARIANT_AXES;

export const PRESETS = {
  shop: { label: "Магазин", modules: ["stock", "catalog"], slug: "magazin" },
  grocery: { label: "Продуктовый магазин", modules: ["stock", "catalog"], slug: "produkty" },
  clothing: { label: "Одежда и обувь", modules: ["stock", "catalog", "variants"], newProduct: "model", slug: "odezhda" },
  // Прокат: главное — выдать и что на руках; продажа и закупки — в меню, не на виду.
  clothing_rental: {
    label: "Прокат одежды",
    modules: ["stock", "catalog", "variants", "rental"],
    navLabels: { "/stock": "Вещи" },
    newProduct: "model",
    quickActions: ["rental_issue", "rentals", "payment_in", "expense"],
    mainAction: "rental_issue",
    words: { purchase: "Покупка вещей" },
    slug: "prokat",
  },
  restaurant: {
    label: "Кафе, ресторан",
    modules: ["stock"],
    navLabels: { "/stock": "Продукты" },
    words: { purchase: "Закупка продуктов" },
    slug: "kafe",
  },
  other: { label: "Другое", modules: ["stock", "catalog"], slug: "drugoe" },
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

/** Оси модели для вида бизнеса. */
export const variantAxes = (type: BusinessType): readonly VariantAxisKey[] =>
  (PRESETS[type] as Preset).variantAxes ?? ["size", "color"];

/** Новый товар этого магазина — сразу модель с размерами и цветами. */
export const startsWithModel = (type: BusinessType, modules: readonly ModuleId[]) =>
  (PRESETS[type] as Preset).newProduct === "model" && modules.includes("variants");

/** Своё слово вида бизнеса; null — у вида его нет. */
export const ownWord = (type: BusinessType, key: WordKey): string | null => (PRESETS[type] as Preset).words?.[key] ?? null;

/** Слово для вида бизнеса: своё или обычное. */
export const word = (type: BusinessType, key: WordKey): string => ownWord(type, key) ?? WORDS[key];

export type QuickAction = { id: QuickActionId; href: string; label: string };

const action = (type: BusinessType, id: QuickActionId): QuickAction => {
  const a: { href: string; label?: string; word?: WordKey } = QUICK_ACTIONS[id];
  return { id, href: a.href, label: a.word ? word(type, a.word) : (a.label ?? id) };
};
const usable = (id: QuickActionId, modules: readonly ModuleId[]) => {
  const m = (QUICK_ACTIONS[id] as { module?: ModuleId }).module;
  return !m || modules.includes(m);
};

/**
 * Кнопки главной: вида бизнеса без выключенных модулей. Крупные (первые две)
 * вида выключены — главная как у магазина, а не «Расход» крупной кнопкой.
 */
export function quickActions(type: BusinessType, modules: readonly ModuleId[]): QuickAction[] {
  const own = (PRESETS[type] as Preset).quickActions ?? DEFAULT_QUICK;
  const list = own.slice(0, 2).every((id) => usable(id, modules)) ? own.filter((id) => usable(id, modules)) : DEFAULT_QUICK;
  return list.map((id) => action(type, id));
}

/** Главная кнопка внизу: вида бизнеса, если её модуль включён; иначе «Продажа». */
export function mainAction(type: BusinessType, modules: readonly ModuleId[]): QuickAction {
  const id = (PRESETS[type] as Preset).mainAction;
  return action(type, id && usable(id, modules) ? id : "sale");
}

/** Вид по адресу регистрации (/start/prokat); незнакомый — null. */
export const businessBySlug = (slug: string): BusinessType | null =>
  BUSINESS_TYPES.find((t) => (PRESETS[t] as Preset).slug === slug) ?? null;

/** Кука: вид бизнеса, выбранный адресом регистрации, — до создания магазина. */
export const BUSINESS_COOKIE = "depter_business";

/** Что сейчас живо в магазине — чтобы предупредить цифрами, а не общими словами. */
export type ShopStats = {
  /** Вещей на руках у клиентов (прокат). */
  rentalsOut: number;
  /** Залогов деньгами в кассе, ещё не возвращённых (текстом, «4 000 сом»), или null. */
  deposits: string | null;
  /** Ссылка на каталог открыта. */
  catalogOpen: boolean;
  /** Заказов из каталога, ещё не проданных. */
  openOrders: number;
};

/**
 * Что изменится при смене вида бизнеса или разделов (просьба пользователя
 * 26.10.2026: не менять молча). Пусто — менять нечего опасного, окна не нужно.
 */
export function businessChangeWarnings(
  from: { type: BusinessType; modules: readonly ModuleId[] },
  to: { type: BusinessType; modules: readonly ModuleId[] },
  stats: ShopStats,
): string[] {
  const off = from.modules.filter((m) => !to.modules.includes(m));
  const out: string[] = [];
  for (const m of off) {
    if (m === "rental")
      out.push(
        stats.rentalsOut > 0
          ? `Скроется «${MODULES.rental.label}»: сейчас на руках ${stats.rentalsOut} шт.${stats.deposits ? `, залоги ${stats.deposits}` : ""}. Пока всё не вернут, на главной останется напоминание.`
          : `Скроется «${MODULES.rental.label}».`,
      );
    else if (m === "catalog")
      out.push(
        stats.catalogOpen
          ? `Скроются «Заказы», ссылку на каталог закроем - клиенты больше не смогут заказать.${stats.openOrders > 0 ? ` Не обработано заказов: ${stats.openOrders}.` : ""}`
          : "Скроются «Каталог» и «Заказы».",
      );
    else if (m === "stock") out.push("Скроется «Склад»: продажа и приход товарами со склада будут недоступны.");
    else if (m === "variants") out.push("Скроются размеры и цвета: товары останутся, но каждый размер - отдельным товаром.");
  }
  const before = mainAction(from.type, from.modules);
  const after = mainAction(to.type, to.modules);
  if (before.id !== after.id) out.push(`Главная кнопка внизу станет «${after.label}» вместо «${before.label}».`);
  if (from.type !== to.type && !out.length) out.push(`Вид станет «${PRESETS[to.type].label}»: названия разделов и кнопки на главной подстроятся под него.`);
  return out;
}
