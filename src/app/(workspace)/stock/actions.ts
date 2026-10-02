"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { isProductUnit, stockNumber, type ProductUnit } from "@/lib/stock";
import { rateInput } from "@/lib/currency";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Код ошибки базы → код для формы (тексты — в форме). */
function failureCode(message: string | undefined): string {
  const text = message ?? "";
  for (const code of [
    "name_taken",
    "sku_taken",
    "invalid_unit",
    "invalid_price",
    "invalid_qty",
    "invalid_name",
    "invalid_sku",
    "note_required",
    "already_stocked",
    "invalid_supplier",
    "invalid_currency",
    "idempotency_conflict",
  ])
    if (text.includes(code)) return code === "idempotency_conflict" ? "retry" : code === "invalid_supplier" ? "party" : code;
  if (text.includes("shop_blocked")) return "blocked";
  return "save";
}

function text(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** Синонимы из поля: через запятую или с новой строки. */
function aliasList(raw: string): string[] {
  return [...new Set(raw.split(/[\n,;]/).map((a) => a.trim()).filter(Boolean))].slice(0, 20);
}

export async function saveProduct(form: FormData) {
  const id = text(form, "id");
  if (id && !uuidPattern.test(id)) redirect("/stock?error=invalid");
  const back = (error: string) => redirect(`/stock/${id || "new"}?error=${error}`);
  const unit = text(form, "unit");
  if (!isProductUnit(unit)) back("invalid_unit");
  const salePrice = stockNumber(text(form, "sale_price") || "0", 2);
  const purchasePrice = stockNumber(text(form, "purchase_price") || "0", 2);
  if (salePrice === null || purchasePrice === null) back("invalid_price");
  const minStock = stockNumber(text(form, "min_stock") || "0", 3);
  const rawOpening = text(form, "opening_stock");
  const opening = rawOpening ? stockNumber(rawOpening, 3) : null;
  if (minStock === null || (rawOpening && opening === null)) back("invalid_qty");

  const { db, organizationId } = await getContext();
  const result = await db.rpc("save_product", {
    p_org: organizationId,
    p_id: id || null,
    p_name: text(form, "name"),
    p_sku: text(form, "sku"),
    p_unit: unit,
    p_sale_price: salePrice,
    p_purchase_price: purchasePrice,
    p_min_stock: minStock,
    p_aliases: aliasList(text(form, "aliases")),
    p_opening_stock: id ? null : opening,
  });
  if (result.error || !result.data) {
    console.error("saveProduct failed", { message: result.error?.message });
    back(failureCode(result.error?.message));
  }
  revalidatePath("/", "layout");
  // «Сохранить и добавить ещё» — сразу пустая форма.
  redirect(form.get("next") === "new" ? `/stock/new?added=${result.data}` : `/stock/${result.data}?saved=1`);
}

export async function archiveProduct(form: FormData) {
  const id = text(form, "id");
  if (!uuidPattern.test(id)) redirect("/stock?error=invalid");
  const archived = form.get("archived") === "true";
  const { db, organizationId } = await getContext();
  const result = await db.rpc("set_product_archived", { p_org: organizationId, p_product: id, p_archived: archived });
  if (result.error) redirect(`/stock/${id}?error=${failureCode(result.error.message)}`);
  revalidatePath("/", "layout");
  redirect(archived ? "/stock?archived_one=1" : `/stock/${id}?restored=1`);
}

export async function adjustStock(form: FormData) {
  const id = text(form, "id");
  const key = text(form, "idempotency_key");
  const mode = text(form, "mode");
  if (!uuidPattern.test(id) || !uuidPattern.test(key) || !["receipt", "writeoff", "count"].includes(mode))
    redirect("/stock?error=invalid");
  const qty = stockNumber(text(form, "qty"), 3);
  if (qty === null || (mode !== "count" && Number(qty) === 0)) redirect(`/stock/${id}?error=invalid_qty&mode=${mode}`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("adjust_stock", {
    p_org: organizationId,
    p_product: id,
    p_mode: mode,
    p_qty: qty,
    p_note: text(form, "note").slice(0, 200) || null,
    p_idempotency_key: key,
  });
  if (result.error) redirect(`/stock/${id}?error=${failureCode(result.error.message)}&mode=${mode}`);
  revalidatePath("/", "layout");
  redirect(`/stock/${id}?stocked=${mode}`);
}

export type QuickProduct = {
  id: string;
  name: string;
  sku: string | null;
  unit: string;
  sale_price: string;
  purchase_price: string;
  stock: string;
  aliases: string[];
  sold_count: number;
};

/** Новый товар прямо из формы продажи или прихода — без перехода на склад. */
export async function quickAddProduct(input: {
  name: string;
  unit: string;
  salePrice: string;
  purchasePrice?: string;
}): Promise<{ product: QuickProduct } | { error: string }> {
  try {
    if (!isProductUnit(input.unit)) return { error: "invalid_unit" };
    const price = stockNumber(input.salePrice || "0", 2);
    const cost = stockNumber(input.purchasePrice || "0", 2);
    if (price === null || cost === null) return { error: "invalid_price" };
    const { db, organizationId } = await getContext();
    const result = await db.rpc("save_product", {
      p_org: organizationId,
      p_id: null,
      p_name: input.name.slice(0, 160),
      p_sku: null,
      p_unit: input.unit,
      p_sale_price: price,
      p_purchase_price: cost,
    });
    if (result.error || !result.data) return { error: failureCode(result.error?.message) };
    const row = await db
      .from("product_balances")
      .select("id,name,sku,unit,sale_price,purchase_price,stock,aliases,sold_count")
      .eq("organization_id", organizationId)
      .eq("id", result.data)
      .single();
    if (row.error) return { error: "save" };
    revalidatePath("/stock");
    return { product: row.data as QuickProduct };
  } catch (error) {
    unstable_rethrow(error);
    console.error("quickAddProduct failed", error);
    return { error: "save" };
  }
}

export type ImportPayload = {
  name: string;
  sku: string | null;
  unit: ProductUnit | null;
  sale_price: string | null;
  purchase_price: string | null;
  stock: string | null;
};
export type ImportResult =
  | { created: number; updated: number; errors: { row: number; error: string }[] }
  | { error: string };

/** Прайс частями по 500 строк — номера строк в ошибках сквозные. */
export async function importProducts(rows: ImportPayload[]): Promise<ImportResult> {
  try {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) return { error: "invalid" };
    const { db, organizationId } = await getContext();
    let created = 0;
    let updated = 0;
    const errors: { row: number; error: string }[] = [];
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500).map((r) => ({
        name: String(r.name ?? "").slice(0, 160),
        sku: r.sku ? String(r.sku).slice(0, 80) : null,
        unit: isProductUnit(r.unit) ? r.unit : null,
        sale_price: r.sale_price,
        purchase_price: r.purchase_price,
        stock: r.stock,
      }));
      const result = await db.rpc("import_products", { p_org: organizationId, p_rows: chunk });
      if (result.error || !result.data) {
        console.error("importProducts failed", { message: result.error?.message, start });
        return { error: failureCode(result.error?.message) };
      }
      const data = result.data as { created: number; updated: number; errors: { row: number; error: string }[] };
      created += data.created;
      updated += data.updated;
      errors.push(...data.errors.map((e) => ({ row: e.row + start, error: e.error })));
    }
    revalidatePath("/", "layout");
    return { created, updated, errors };
  } catch (error) {
    unstable_rethrow(error);
    console.error("importProducts: unexpected failure", error);
    return { error: "save" };
  }
}

export type SaleLine = { product: string; qty: string; price: string };
export type SaleItemsState = { error?: string; attempt?: number };

/**
 * Продажа накладной из приложения. Успех — экран отправки клиенту (как у
 * продажи по фото); ошибка возвращается в форму, строки не сбрасываются.
 */
export async function commitSaleItems(previous: SaleItemsState, form: FormData): Promise<SaleItemsState> {
  const attempt = (previous.attempt ?? 0) + 1;
  let saleId: string;
  try {
    const customer = text(form, "customer_id");
    const key = text(form, "idempotency_key");
    if (!uuidPattern.test(customer)) return { error: "party", attempt };
    if (!uuidPattern.test(key)) return { error: "save", attempt };
    let lines: SaleLine[];
    try {
      lines = JSON.parse(text(form, "lines")) as SaleLine[];
    } catch {
      return { error: "lines", attempt };
    }
    if (!Array.isArray(lines) || lines.length === 0) return { error: "lines", attempt };
    if (lines.length > 200) return { error: "too_many", attempt };
    const clean: SaleLine[] = [];
    for (const line of lines) {
      const qty = stockNumber(line.qty, 3);
      const price = stockNumber(line.price, 2);
      if (!uuidPattern.test(String(line.product)) || !qty || Number(qty) <= 0) return { error: "qty", attempt };
      if (price === null) return { error: "price", attempt };
      clean.push({ product: line.product, qty, price });
    }
    const rawRate = text(form, "fx_rate");
    const rate = rawRate ? rateInput(rawRate) : null;
    if (rawRate && !rate) return { error: "rate", attempt };
    const { db, organizationId } = await getContext();
    const result = await db.rpc("commit_sale_items", {
      p_org: organizationId,
      p_customer: customer,
      p_lines: clean,
      p_paid_immediately: form.get("paid_immediately") === "true",
      p_idempotency_key: key,
      p_fx_rate: rate,
    });
    if (result.error || !result.data) {
      console.error("commitSaleItems: RPC failed", { message: result.error?.message, lines: clean.length });
      const code = failureCode(result.error?.message);
      return { error: code === "invalid_currency" ? "rate" : code, attempt };
    }
    saleId = result.data as string;
  } catch (error) {
    unstable_rethrow(error);
    console.error("commitSaleItems: unexpected failure", error);
    return { error: "save", attempt };
  }
  revalidatePath("/", "layout");
  redirect(`/money/send/${saleId}?done=1`);
}

export type ReceiveItem = { line: string; product?: string | null; name?: string; unit?: string; sale_price?: string };

/** Строки распознанной накладной прихода → на склад. */
export async function receivePurchase(form: FormData) {
  const purchase = text(form, "purchase_id");
  const documentId = text(form, "document_id");
  if (!uuidPattern.test(purchase) || !uuidPattern.test(documentId)) redirect("/documents?error=invalid");
  let items: ReceiveItem[] = [];
  try {
    items = (JSON.parse(text(form, "items")) as ReceiveItem[]).filter((i) => uuidPattern.test(String(i.line)));
  } catch {
    redirect(`/documents/${documentId}?stock_error=invalid`);
  }
  if (!items.length) redirect(`/documents/${documentId}?stock_error=empty`);
  const payload = items.map((i) => ({
    line: i.line,
    product: i.product && uuidPattern.test(i.product) ? i.product : null,
    name: i.name?.slice(0, 160) || null,
    unit: isProductUnit(i.unit) ? i.unit : null,
    sale_price: i.sale_price ? stockNumber(i.sale_price, 2) : null,
  }));
  const { db, organizationId } = await getContext();
  const result = await db.rpc("receive_purchase_lines", {
    p_org: organizationId,
    p_purchase: purchase,
    p_items: payload,
  });
  if (result.error) {
    console.error("receivePurchase failed", { message: result.error.message });
    redirect(`/documents/${documentId}?stock_error=${failureCode(result.error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/documents/${documentId}?stocked=${result.data}`);
}

/**
 * Приход товарами без фото: поставщик, строки «товар — количество — цена
 * закупки». Долг поставщику на сумму строк, остаток и закупочная цена — сразу.
 * Успех — экран результата прихода; ошибка возвращается в форму.
 */
export async function commitPurchaseItems(previous: SaleItemsState, form: FormData): Promise<SaleItemsState> {
  const attempt = (previous.attempt ?? 0) + 1;
  let purchaseId: string;
  try {
    const supplier = text(form, "supplier_id");
    const key = text(form, "idempotency_key");
    if (!uuidPattern.test(supplier)) return { error: "party", attempt };
    if (!uuidPattern.test(key)) return { error: "save", attempt };
    let lines: SaleLine[];
    try {
      lines = JSON.parse(text(form, "lines")) as SaleLine[];
    } catch {
      return { error: "lines", attempt };
    }
    if (!Array.isArray(lines) || lines.length === 0) return { error: "lines", attempt };
    if (lines.length > 200) return { error: "too_many", attempt };
    const clean: SaleLine[] = [];
    for (const line of lines) {
      const qty = stockNumber(line.qty, 3);
      const price = stockNumber(line.price, 2);
      if (!uuidPattern.test(String(line.product)) || !qty || Number(qty) <= 0) return { error: "qty", attempt };
      if (price === null) return { error: "price", attempt };
      clean.push({ product: line.product, qty, price });
    }
    const rawRate = text(form, "fx_rate");
    const rate = rawRate ? rateInput(rawRate) : null;
    if (rawRate && !rate) return { error: "rate", attempt };
    const { db, organizationId } = await getContext();
    const result = await db.rpc("commit_purchase_items", {
      p_org: organizationId,
      p_supplier: supplier,
      p_lines: clean,
      p_idempotency_key: key,
      p_fx_rate: rate,
    });
    if (result.error || !result.data) {
      console.error("commitPurchaseItems: RPC failed", { message: result.error?.message, lines: clean.length });
      const code = failureCode(result.error?.message);
      return { error: code === "invalid_currency" ? "rate" : code, attempt };
    }
    purchaseId = result.data as string;
  } catch (error) {
    unstable_rethrow(error);
    console.error("commitPurchaseItems: unexpected failure", error);
    return { error: "save", attempt };
  }
  revalidatePath("/", "layout");
  redirect(`/money/done/purchase/${purchaseId}`);
}
