/**
 * Склад: единицы товара, числа из форм и разбор прайса для импорта. Без
 * импортов — файл читают тесты напрямую.
 *
 * Единицы — тот же список, что private.product_units() в миграции
 * warehouse.sql (и проверка products_unit_check).
 */
export const PRODUCT_UNITS = [
  "шт",
  "м",
  "м²",
  "м³",
  "кг",
  "т",
  "л",
  "упак",
  "пачка",
  "рулон",
  "мешок",
  "лист",
  "компл",
  "пара",
] as const;
export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export function isProductUnit(value: unknown): value is ProductUnit {
  return typeof value === "string" && (PRODUCT_UNITS as readonly string[]).includes(value);
}

// Как единицу пишут в накладных и прайсах → наша единица.
const ALIASES: Record<string, ProductUnit> = {
  шт: "шт", штук: "шт", штука: "шт", штуки: "шт", pcs: "шт", pc: "шт", ед: "шт",
  м: "м", метр: "м", метров: "м", метра: "м", пм: "м", погм: "м", мп: "м", m: "м",
  м2: "м²", "м²": "м²", квм: "м²", мкв: "м²", m2: "м²",
  м3: "м³", "м³": "м³", кубм: "м³", куб: "м³", мкуб: "м³", m3: "м³",
  кг: "кг", килограмм: "кг", kg: "кг",
  т: "т", тн: "т", тонна: "т", тонн: "т",
  л: "л", литр: "л", литров: "л", l: "л",
  упак: "упак", уп: "упак", упаковка: "упак", кор: "упак", коробка: "упак",
  пач: "пачка", пачка: "пачка", пачек: "пачка",
  рул: "рулон", рулон: "рулон", рулонов: "рулон",
  меш: "мешок", мешок: "мешок", мешков: "мешок",
  лист: "лист", листов: "лист", лис: "лист",
  компл: "компл", комплект: "компл", кмп: "компл", к_т: "компл", кт: "компл",
  пар: "пара", пара: "пара",
};

/** «кв.м», «М2», «шт.» → наша единица; не узнали — null. */
export function normalizeUnit(raw: unknown): ProductUnit | null {
  const key = String(raw ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[\s.,]/g, "")
    .replace("/", "_");
  if (!key) return null;
  return ALIASES[key] ?? null;
}

/**
 * Число из поля или ячейки прайса: «1 250,50», «85.5 сом», «12,5» → "1250.5"
 * (с точкой, без лишних нулей); не больше `scale` знаков после запятой.
 * Пусто или мусор — null.
 */
export function stockNumber(raw: unknown, scale: number): string | null {
  let s = String(raw ?? "")
    .replace(/[\s\u00a0']/g, "")
    .replace(/^(\$|₽)/, "")
    .replace(/(сом|руб|р\.|₽|\$|usd|kgs|rub|c|с)$/i, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replaceAll(".", "").replace(",", ".") : s.replaceAll(",", "");
  else s = s.replace(",", ".");
  if (!/^\d{1,14}(\.\d+)?$/.test(s)) return null;
  const factor = 10 ** scale;
  const rounded = Math.round(Number(s) * factor) / factor;
  if (!Number.isFinite(rounded) || rounded >= 1e13) return null;
  return String(rounded);
}

export type ImportField =
  | "name"
  | "sku"
  | "unit"
  | "sale_price"
  | "purchase_price"
  | "purchase_currency"
  | "stock"
  | "category"
  | "subcategory";
export type ColumnMap = Partial<Record<ImportField, number>>;

export const IMPORT_FIELD_LABEL: Record<ImportField, string> = {
  name: "Название",
  sku: "Код",
  unit: "Единица",
  sale_price: "Цена продажи",
  purchase_price: "Цена закупки",
  purchase_currency: "Валюта закупки",
  stock: "Остаток",
  category: "Категория",
  subcategory: "Подкатегория",
};

/** Валюта цены закупки — как CURRENCIES в currency.ts (здесь без импортов). */
export type CostCurrency = "KGS" | "USD" | "RUB";
export const COST_CURRENCIES: CostCurrency[] = ["KGS", "USD", "RUB"];

/**
 * Валюта из ячейки или шапки прайса: «$», «USD», «долл.», «у.е.» — доллар;
 * «₽», «руб» — рубль; «сом», «KGS», «с» — сом. Не нашли — null.
 */
export function costCurrency(raw: unknown): CostCurrency | null {
  const text = String(raw ?? "").toLowerCase().replace(/ё/g, "е").trim();
  if (!text) return null;
  if (/\$|usd|долл|^дол\.?$|у\.\s?е\./.test(text)) return "USD";
  if (/₽|rub|руб|^р\.?$/.test(text)) return "RUB";
  if (/kgs|сом|^[сc]\.?$/.test(text)) return "KGS";
  return null;
}

// Порядок важен: «валюта закупки» раньше «закупки», «цена закупки» раньше просто «цены».
// «Подкатегория» раньше «категории»; «Группа товаров» — категория, не название.
const HEADER_RULES: [ImportField, RegExp][] = [
  ["subcategory", /подкатег|подгрупп|subcategor/],
  ["category", /категор|групп|раздел|categor/],
  ["purchase_currency", /валют|currency|^вал\.?$/],
  ["purchase_price", /закуп|себест|входн|приходн/],
  ["sale_price", /цена|розн|продаж|стоимост|price/],
  ["stock", /остат|кол-?во|количеств|налич|qty|склад/],
  ["unit", /^ед|единиц|изм|unit/],
  ["sku", /код|артик|sku|^id$|штрих/],
  ["name", /наимен|назван|товар|номенкл|name|продукц/],
];

/**
 * Строка шапки (первая из первых 10, где нашлась колонка названия) и какие
 * колонки что значат. Без шапки — null: колонки выбирает человек.
 */
export function detectColumns(table: string[][]): { header: number; columns: ColumnMap } | null {
  for (let r = 0; r < Math.min(10, table.length); r++) {
    const columns: ColumnMap = {};
    table[r].forEach((cell, c) => {
      const text = cell.toLowerCase().replace(/ё/g, "е").trim();
      if (!text) return;
      const rule = HEADER_RULES.find(([field, re]) => columns[field] === undefined && re.test(text));
      if (rule) columns[rule[0]] = c;
    });
    if (columns.name !== undefined) return { header: r, columns };
  }
  return null;
}

export type ImportRow = {
  /** Номер строки в файле (с 1) — для сообщений об ошибках. */
  line: number;
  name: string;
  sku: string | null;
  unit: ProductUnit | null;
  sale_price: string | null;
  purchase_price: string | null;
  /** Валюта цены закупки; null — цены закупки в строке нет. */
  purchase_currency: CostCurrency | null;
  stock: string | null;
  /** Категория и подкатегория; пусто — категория товара не меняется. */
  category: string | null;
  subcategory: string | null;
  /** Что не так с ячейками — строка всё равно уйдёт, без этих значений. */
  warnings: string[];
};

/**
 * Строки прайса после шапки → товары. Строки без названия пропускаются.
 * Валюта закупки: из колонки валюты, иначе из ячейки цены («0,29 $»),
 * иначе `currency` — выбранная для всего файла.
 */
export function importRows(
  table: string[][],
  header: number,
  columns: ColumnMap,
  currency: CostCurrency = "KGS",
): ImportRow[] {
  const rows: ImportRow[] = [];
  const cell = (row: string[], field: ImportField) =>
    columns[field] === undefined ? "" : (row[columns[field]!] ?? "").trim();
  for (let r = header + 1; r < table.length; r++) {
    const row = table[r];
    const name = cell(row, "name").replace(/\s+/g, " ").slice(0, 160);
    if (!name) continue;
    const warnings: string[] = [];
    const number = (field: ImportField, scale: number) => {
      const raw = cell(row, field);
      if (!raw) return null;
      const value = stockNumber(raw, scale);
      if (value === null) warnings.push(`${IMPORT_FIELD_LABEL[field]}: «${raw}» - не число`);
      return value;
    };
    const rawUnit = cell(row, "unit");
    const unit = rawUnit ? normalizeUnit(rawUnit) : null;
    if (rawUnit && !unit) warnings.push(`Единица «${rawUnit}» - не знаем, будет «шт»`);
    const purchasePrice = number("purchase_price", 2);
    // «Освещение / Светильники» в одной ячейке — категория и подкатегория.
    const rawCategory = cell(row, "category").replace(/\s+/g, " ");
    const [top, ...rest] = rawCategory.split(/\s*(?:\/|>|\\)\s*/).filter(Boolean);
    const category = (top ?? "").slice(0, 60) || null;
    const subcategory = category ? (cell(row, "subcategory").replace(/\s+/g, " ") || rest.join(" ")).slice(0, 60) || null : null;
    const rawCurrency = cell(row, "purchase_currency");
    const ownCurrency = costCurrency(rawCurrency);
    if (rawCurrency && !ownCurrency && purchasePrice !== null)
      warnings.push(`Валюта «${rawCurrency}» - не знаем, будет ${currency}`);
    rows.push({
      line: r + 1,
      name,
      sku: cell(row, "sku").slice(0, 80) || null,
      unit,
      sale_price: number("sale_price", 2),
      purchase_price: purchasePrice,
      purchase_currency:
        purchasePrice === null ? null : (ownCurrency ?? costCurrency(cell(row, "purchase_price").replace(/[\d\s.,]/g, "")) ?? currency),
      stock: number("stock", 3),
      category,
      subcategory,
      warnings,
    });
  }
  return rows;
}

/** Тексты ошибок склада по коду из адреса или ответа действия. */
export const STOCK_ERROR_TEXT: Record<string, string> = {
  name_taken: "Товар с таким названием уже есть - откройте его или назовите иначе.",
  sku_taken: "Этот код уже у другого товара.",
  invalid_unit: "Выберите единицу из списка.",
  invalid_currency: "Валюта - сом, доллар или рубль.",
  invalid_price: "Цена - число не меньше нуля, до 2 знаков после запятой.",
  invalid_qty: "Количество - число не меньше нуля, до 3 знаков после запятой.",
  invalid_name: "Введите название (до 160 символов).",
  invalid_sku: "Код - до 80 символов.",
  category_taken: "Товар сохранён, но такая категория уже есть - выберите её из списка.",
  invalid_category: "Товар сохранён, но категорию поставить не удалось - выберите её ещё раз.",
  note_required: "Напишите, почему списываете (брак, бой, недостача…).",
  already_stocked: "Эта накладная уже принята на склад.",
  blocked: "Магазин в режиме «только просмотр» - изменения не сохраняются. Продлите оплату.",
  retry: "Эта запись уже сохранена - возможно, при прошлой попытке. Проверьте историю.",
  invalid: "Проверьте данные и попробуйте снова.",
  empty: "Отметьте хотя бы одну строку.",
  save: "Не удалось сохранить. Проверьте данные и попробуйте снова.",
};

/** Число из базы ("12.5", "-3") → целое в 1/10^scale; мусор — 0. */
function scaled(value: string | null | undefined, scale: number): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value ?? ""));
  if (!match) return 0n;
  const [, sign, whole, fraction = ""] = match;
  const n = BigInt(whole + fraction.slice(0, scale).padEnd(scale, "0"));
  return sign ? -n : n;
}

/** Целое в 1/10^5 → сумма с копейками ("1250.5"), округление до 2 знаков. */
function fromScaled5(value: bigint): string {
  const cents = (value + 500n) / 1000n;
  const whole = cents / 100n;
  const part = (cents % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return whole.toString() + (part ? "." + part : "");
}

export type StockValueRow = {
  stock: string;
  purchase_price: string | null;
  purchase_currency?: string | null;
  sale_price: string | null;
};

export type StockValue = {
  /** Остаток × цена закупки — по валютам закупки (null у товара — валюта магазина). */
  cost: Partial<Record<CostCurrency, string>>;
  /** Остаток × цена продажи, в валюте магазина (только товары с ценой продажи). */
  sale: string;
  /** Сколько товаров в наличии (остаток > 0). */
  inStock: number;
  /** В наличии, но без цены закупки — в сумму закупки не вошли. */
  noCost: number;
  /** В наличии, но без цены продажи. */
  noSale: number;
};

/**
 * Витрина склада (просьба пользователя 14.10.2026): сколько стоит то, что
 * лежит на складе. Считаются только товары с остатком больше нуля —
 * минус (продали больше, чем было) сумму не уменьшает. Точно, без float.
 */
export function stockValue(rows: StockValueRow[], shop: CostCurrency): StockValue {
  const cost: Partial<Record<CostCurrency, bigint>> = {};
  let sale = 0n;
  let inStock = 0;
  let noCost = 0;
  let noSale = 0;
  for (const row of rows) {
    const qty = scaled(row.stock, 3);
    if (qty <= 0n) continue;
    inStock++;
    const price = scaled(row.purchase_price, 2);
    if (price > 0n) {
      const currency = (COST_CURRENCIES as string[]).includes(row.purchase_currency ?? "")
        ? (row.purchase_currency as CostCurrency)
        : shop;
      cost[currency] = (cost[currency] ?? 0n) + qty * price;
    } else noCost++;
    const salePrice = scaled(row.sale_price, 2);
    if (salePrice > 0n) sale += qty * salePrice;
    else noSale++;
  }
  const costText: Partial<Record<CostCurrency, string>> = {};
  for (const currency of COST_CURRENCIES) if (cost[currency]) costText[currency] = fromScaled5(cost[currency]!);
  return { cost: costText, sale: fromScaled5(sale), inStock, noCost, noSale };
}
