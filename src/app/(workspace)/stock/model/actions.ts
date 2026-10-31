"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { isProductUnit, stockNumber } from "@/lib/stock";
import { isCurrency } from "@/lib/currency";
import { refreshCatalog } from "@/lib/catalog-cache";
import { MODEL_LIMITS, parseAxes } from "@/lib/product-model";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
};

const json = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** Код ошибки базы → код для формы (тексты — STOCK_ERROR_TEXT). */
const failure = (message = "") =>
  ["name_taken", "invalid_axes", "invalid_variants", "invalid_price", "invalid_currency", "invalid_name", "invalid_model", "invalid_unit", "invalid_qty"].find(
    (code) => message.includes(code),
  ) ?? (message.includes("shop_blocked") ? "blocked" : "save");

/**
 * Модель с размерами и цветами (миграции 20261029100000, 20261111100000):
 * новая — из формы «Новый товар» с единицей и минимумом, или новые сочетания
 * к ней. Каждое сочетание база создаёт обычным товаром; уже существующие
 * пропускает, а новые берут единицу и минимум у товаров модели.
 */
export async function saveProductModel(form: FormData) {
  const id = text(form, "model_id");
  if (id && !uuidPattern.test(id)) redirect("/stock?error=invalid");
  const back = (error: string): never => redirect(id ? `/stock/model/${id}?error=${error}` : `/stock/new?error=${error}`);

  const axes = parseAxes(json(text(form, "axes")));
  if (!axes.length || axes.length > MODEL_LIMITS.axes) back("invalid_axes");
  const rawRows = json(text(form, "rows"));
  if (!Array.isArray(rawRows) || rawRows.length > MODEL_LIMITS.rows) back("invalid_variants");
  const rows = (rawRows as { attrs?: unknown; qty?: unknown }[]).map((row) => {
    const qty = stockNumber(String(row?.qty ?? "").trim() || "0", 3);
    if (qty === null) back("invalid_qty");
    return { attrs: row?.attrs, qty };
  });

  const salePrice = stockNumber(text(form, "sale_price") || "0", 2);
  const purchasePrice = stockNumber(text(form, "purchase_price") || "0", 2);
  if (salePrice === null || purchasePrice === null) back("invalid_price");
  const purchaseCurrency = text(form, "purchase_currency");
  if (purchaseCurrency && !isCurrency(purchaseCurrency)) back("invalid_currency");
  // Единица и минимум — у новой модели; к существующей база берёт их у её товаров.
  const unit = id ? null : text(form, "unit") || "шт";
  if (unit !== null && !isProductUnit(unit)) back("invalid_unit");
  const minStock = id ? "0" : stockNumber(text(form, "min_stock") || "0", 3);
  if (minStock === null) back("invalid_qty");

  const { db, organizationId } = await getContext();
  const result = await db.rpc("save_product_model", {
    p_org: organizationId,
    p_model: id || null,
    p_name: text(form, "name"),
    p_axes: axes,
    p_rows: rows,
    p_sale_price: salePrice,
    p_purchase_price: purchasePrice,
    p_purchase_currency: purchaseCurrency || null,
    p_apply_prices: Boolean(id) && form.get("apply_prices") === "on",
    p_unit: unit,
    p_min_stock: minStock,
  });
  if (result.error || !result.data) {
    console.error("saveProductModel failed", { message: result.error?.message });
    back(failure(result.error?.message));
  }
  const saved = String(result.data);

  // Категория — только у новой модели, всем её товарам; ошибка товары не теряет.
  let category = text(form, "category_id");
  if (!id && form.get("category_field") === "1" && category) {
    const again = (error: string): never => redirect(`/stock/model/${saved}?error=${error}`);
    if (category === "__new") {
      const parent = text(form, "new_category_parent");
      const created = await db.rpc("save_product_category", {
        p_org: organizationId,
        p_id: null,
        p_name: text(form, "new_category").slice(0, 60),
        p_parent: uuidPattern.test(parent) ? parent : null,
      });
      if (created.error) again(created.error.message.includes("category_taken") ? "category_taken" : "invalid_category");
      category = String(created.data);
    }
    const variants = await db.from("products").select("id").eq("organization_id", organizationId).eq("model_id", saved);
    const ids = (variants.data ?? []).map((v) => v.id as string);
    if (!uuidPattern.test(category) || !ids.length) again("invalid_category");
    const set = await db.rpc("set_products_category", { p_org: organizationId, p_products: ids, p_category: category });
    if (set.error) {
      console.error("saveProductModel category failed", { message: set.error.message });
      again("invalid_category");
    }
  }

  await refreshCatalog(db, organizationId);
  revalidatePath("/", "layout");
  // «Добавить и ещё один» — сразу пустая форма.
  redirect(!id && form.get("next") === "new" ? `/stock/new?added=${saved}&kind=model` : `/stock/model/${saved}?saved=1`);
}
