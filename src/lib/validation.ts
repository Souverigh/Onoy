export type Directory = "customers" | "suppliers" | "products";
export const directories = ["customers", "suppliers", "products"] as const;
export function isDirectory(value: string): value is Directory {
  return (directories as readonly string[]).includes(value);
}
export function decimalInput(value: unknown, scale: number): string {
  // Продавцы группируют суммы пробелом ("54 270", как отображает money() —
  // src/lib/format.ts), и это не то же самое, что 3 цифры после запятой.
  let s = String(value ?? "0")
    .trim()
    .replace(/[\s ']/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    // Оба разделителя — последний из них десятичный, остальные разделяли тысячи.
    s = lastComma > lastDot
      ? s.replaceAll(".", "").replace(",", ".")
      : s.replaceAll(",", "");
  } else if (lastComma !== -1) {
    s = s.replace(",", ".");
  }
  if (!new RegExp(`^\\d{1,${16 - scale}}(\\.\\d{1,${scale}})?$`).test(s))
    throw new Error(
      `Введите неотрицательное число, максимум ${scale} знака после запятой`,
    );
  const [whole, decimal = ""] = s.split(".");
  return `${whole.replace(/^0+(?=\d)/, "")}.${decimal.padEnd(scale, "0")}`;
}
function text(value: unknown, max: number, required = false) {
  const s = String(value ?? "").trim();
  if ((required && !s) || s.length > max)
    throw new Error(`Заполните поле (до ${max} символов)`);
  return s;
}
export function directoryInput(kind: Directory, data: Record<string, unknown>) {
  const name = text(data.name, 160, true);
  if (kind === "products")
    return {
      name,
      sku: text(data.sku, 80) || null,
      unit: ["шт", "м", "кг", "упак", "л"].includes(String(data.unit))
        ? String(data.unit)
        : "шт",
      purchase_price: decimalInput(data.purchase_price, 2),
      sale_price: decimalInput(data.sale_price, 2),
      min_stock: decimalInput(data.min_stock, 3),
    };
  const base = { name, phone: text(data.phone, 40), notes: text(data.notes, 2000) };
  if (kind === "suppliers") return base;
  // Лимит долга: пусто — без лимита.
  const limit = String(data.credit_limit ?? "").trim();
  return { ...base, credit_limit: limit ? decimalInput(limit, 2) : null };
}
