"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireOwner } from "@/lib/context";
import { isProductUnit, stockNumber, type ProductUnit } from "@/lib/stock";
import { isCurrency, rateInput, type Currency } from "@/lib/currency";
import { bishkekDate } from "@/lib/day-summary";
import { recordDateTime } from "@/lib/record-date";
import { noteInput, saveRecordNote } from "@/lib/record-note";
import { correctionOf } from "@/lib/record-maker";
import { refreshCatalog } from "@/lib/catalog-cache";

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
    "invalid_date",
    "already_corrected",
    "owner_only",
    "has_returns",
    "product_merged",
  ])
    if (text.includes(code))
      return code === "idempotency_conflict"
        ? "retry"
        : code === "invalid_supplier"
          ? "party"
          : code === "invalid_date"
            ? "date"
            : code === "already_corrected"
              ? "corrected"
              : code === "owner_only"
                ? "fix_owner"
                : code === "has_returns"
                  ? "fix_return"
                  : code;
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
  // Валюта цены закупки; пусто — валюта магазина.
  const purchaseCurrency = text(form, "purchase_currency");
  if (purchaseCurrency && !isCurrency(purchaseCurrency)) back("invalid_currency");
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
    p_purchase_currency: purchaseCurrency || null,
  });
  if (result.error || !result.data) {
    console.error("saveProduct failed", { message: result.error?.message });
    back(failureCode(result.error?.message));
  }
  // Категория — отдельным шагом: товар уже сохранён, ошибка категории его не теряет.
  if (form.get("category_field") === "1") {
    const saved = String(result.data);
    const again = (error: string) => redirect(`/stock/${saved}?error=${error}`);
    let category: string | null = text(form, "category_id") || null;
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
    if (category !== null && !uuidPattern.test(category)) again("invalid_category");
    if (category !== null || id) {
      const set = await db.rpc("set_products_category", { p_org: organizationId, p_products: [saved], p_category: category });
      if (set.error) {
        console.error("saveProduct category failed", { message: set.error.message });
        again("invalid_category");
      }
    }
  }
  // Цена, название, архив — в каталоге клиентов тоже.
  await refreshCatalog(db, organizationId);
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
  // Цена, название, архив — в каталоге клиентов тоже.
  await refreshCatalog(db, organizationId);
  revalidatePath("/", "layout");
  redirect(archived ? "/stock?archived_one=1" : `/stock/${id}?restored=1`);
}

/** Дубль → товар (владелец): записи дубля переходят к товару, дубль — в архив. */
export async function mergeProducts(form: FormData) {
  const id = text(form, "id");
  const into = text(form, "into");
  if (!uuidPattern.test(id)) redirect("/stock?error=invalid");
  if (!uuidPattern.test(into) || into === id) redirect(`/stock/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("merge_products", { p_org: organizationId, p_from: id, p_into: into });
  if (result.error) {
    console.error("mergeProducts failed", { message: result.error.message });
    redirect(`/stock/${id}?error=merge`);
  }
  await refreshCatalog(db, organizationId);
  revalidatePath("/", "layout");
  redirect(`/stock/${into}?merged=1`);
}

/** Отмена объединения в течение суток. */
export async function undoProductMerge(form: FormData) {
  const id = text(form, "id");
  const merge = text(form, "merge");
  if (!uuidPattern.test(id)) redirect("/stock?error=invalid");
  if (!uuidPattern.test(merge)) redirect(`/stock/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("undo_product_merge", { p_org: organizationId, p_merge: merge });
  if (result.error) {
    console.error("undoProductMerge failed", { message: result.error.message });
    redirect(`/stock/${id}?error=merge_expired`);
  }
  await refreshCatalog(db, organizationId);
  revalidatePath("/", "layout");
  redirect(`/stock/${id}?unmerged=1`);
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
  /** Валюта цены закупки; null — валюта магазина. */
  purchase_currency: string | null;
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
  /** Валюта цены закупки — валюта поставщика в форме прихода. */
  purchaseCurrency?: Currency;
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
      p_purchase_currency: isCurrency(input.purchaseCurrency) ? input.purchaseCurrency : null,
    });
    if (result.error || !result.data) return { error: failureCode(result.error?.message) };
    const row = await db
      .from("product_balances")
      .select("id,name,sku,unit,sale_price,purchase_price,purchase_currency,stock,aliases,sold_count")
      .eq("organization_id", organizationId)
      .eq("id", result.data)
      .single();
    if (row.error) return { error: "save" };
    await refreshCatalog(db, organizationId);
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
  purchase_currency: Currency | null;
  stock: string | null;
  category?: string | null;
  subcategory?: string | null;
};
export type ImportResult =
  | {
      created: number;
      updated: number;
      /** other — название товара, у которого уже этот код (ошибка sku_other). */
      errors: { row: number; error: string; other?: string }[];
      /** Сколько товаров вернули из архива. */
      restored: number;
      /** Товар найден по названию, код сменился на код из файла; old — прежний. */
      recoded: { row: number; old: string }[];
      /** Загрузка оборвалась: записаны первые `stopped` строк, остальные — нет. */
      stopped?: number;
      /** У скольких товаров категория из файла; categoryError — товары есть, категории не встали. */
      categorized?: number;
      categoryError?: boolean;
    }
  | { error: string };

/**
 * Прайс частями по 500 строк — номера строк в ошибках сквозные. Каждая часть
 * записывается сразу: оборвалось на второй — первая уже на складе, это и
 * возвращаем (`stopped`), повторная загрузка файла ничего не задвоит.
 */
export async function importProducts(rows: ImportPayload[]): Promise<ImportResult> {
  try {
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 2000) return { error: "invalid" };
    const { db, organizationId, isOwner } = await getContext();
    if (!isOwner) return { error: "owner_only" };
    let created = 0;
    let updated = 0;
    let restored = 0;
    let stopped: number | undefined;
    const errors: { row: number; error: string; other?: string }[] = [];
    const recoded: { row: number; old: string }[] = [];
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500).map((r) => ({
        name: String(r.name ?? "").slice(0, 160),
        sku: r.sku ? String(r.sku).slice(0, 80) : null,
        unit: isProductUnit(r.unit) ? r.unit : null,
        sale_price: r.sale_price,
        purchase_price: r.purchase_price,
        purchase_currency: r.purchase_price !== null && isCurrency(r.purchase_currency) ? r.purchase_currency : null,
        stock: r.stock,
      }));
      let result;
      try {
        result = await db.rpc("import_products", { p_org: organizationId, p_rows: chunk });
      } catch (error) {
        unstable_rethrow(error);
        console.error("importProducts chunk failed", error);
        result = null;
      }
      if (!result || result.error || !result.data) {
        console.error("importProducts failed", { message: result?.error?.message, start });
        if (start === 0) return { error: failureCode(result?.error?.message) };
        stopped = start;
        break;
      }
      const data = result.data as {
        created: number;
        updated: number;
        restored?: number;
        recoded?: { row: number; old: string }[];
        errors: { row: number; error: string; other?: string }[];
      };
      created += data.created;
      updated += data.updated;
      restored += data.restored ?? 0;
      errors.push(...data.errors.map((e) => ({ ...e, row: e.row + start })));
      recoded.push(...(data.recoded ?? []).map((e) => ({ ...e, row: e.row + start })));
    }
    // Категории — после товаров: товар ищется по коду или названию, как при импорте.
    let categorized = 0;
    let categoryError = false;
    const withCategory = rows
      .slice(0, stopped ?? rows.length)
      .filter((r) => r.category && String(r.category).trim())
      .map((r) => ({
        sku: r.sku ? String(r.sku).slice(0, 80) : null,
        name: String(r.name ?? "").slice(0, 160),
        category: String(r.category).slice(0, 60),
        subcategory: r.subcategory ? String(r.subcategory).slice(0, 60) : null,
      }));
    for (let start = 0; start < withCategory.length && !categoryError; start += 500) {
      const result = await db.rpc("set_import_categories", { p_org: organizationId, p_rows: withCategory.slice(start, start + 500) });
      if (result.error) {
        console.error("importProducts categories failed", { message: result.error.message, start });
        categoryError = true;
      } else categorized += Number(result.data) || 0;
    }
    await refreshCatalog(db, organizationId);
    revalidatePath("/", "layout");
    return { created, updated, restored, recoded, stopped, errors, categorized, categoryError };
  } catch (error) {
    unstable_rethrow(error);
    console.error("importProducts: unexpected failure", error);
    return { error: "save" };
  }
}

/** Записали по черновику — он больше не нужен. Ошибка не мешает записи. */
async function dropDraft(form: FormData) {
  const id = text(form, "draft_id");
  if (!uuidPattern.test(id)) return;
  try {
    const { db, organizationId } = await getContext();
    const result = await db.rpc("delete_record_draft", { p_org: organizationId, p_id: id });
    if (result.error) console.error("dropDraft failed", { message: result.error.message });
  } catch (error) {
    console.error("dropDraft failed", error);
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
    // Продажа за другой день («забыл записать вчера»).
    const occurredAt = recordDateTime(text(form, "record_date"), bishkekDate());
    if (occurredAt === "invalid") return { error: "date", attempt };
    const { db, organizationId } = await getContext();
    // Исправление: новая продажа и отмена старой — одной транзакцией в базе.
    const correction = correctionOf(form);
    const result = await db.rpc(correction ? "commit_sale_items_correction" : "commit_sale_items", {
      ...correction,
      p_org: organizationId,
      p_customer: customer,
      p_lines: clean,
      p_paid_immediately: form.get("paid_immediately") === "true",
      p_idempotency_key: key,
      p_fx_rate: rate,
      ...(occurredAt ? { p_occurred_at: occurredAt } : {}),
    });
    if (result.error || !result.data) {
      console.error("commitSaleItems: RPC failed", { message: result.error?.message, lines: clean.length });
      const code = failureCode(result.error?.message);
      return { error: code === "invalid_currency" ? "rate" : code, attempt };
    }
    saleId = result.data as string;
    await saveRecordNote(db, organizationId, "sale", saleId, noteInput(form.get("note")));
    await dropDraft(form);
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
 * закупки» в выбранной валюте. Долг поставщику на сумму строк (в другой
 * валюте — по курсу), остаток и закупочная цена (в валюте строк) — сразу.
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
    const occurredAt = recordDateTime(text(form, "record_date"), bishkekDate());
    if (occurredAt === "invalid") return { error: "date", attempt };
    // Валюта цен выбрана в форме (по умолчанию — поставщика); не валюта
    // поставщика — долг по курсу (миграция purchase_items_line_currency.sql).
    const lineCurrency = text(form, "line_currency");
    if (!isCurrency(lineCurrency)) return { error: "save", attempt };
    const rawRate = text(form, "fx_rate");
    const rate = rawRate ? rateInput(rawRate) : null;
    if (rawRate && !rate) return { error: "rate", attempt };
    const { db, organizationId } = await getContext();
    const correction = correctionOf(form);
    const result = await db.rpc(correction ? "commit_purchase_items_correction" : "commit_purchase_items", {
      ...correction,
      p_org: organizationId,
      p_supplier: supplier,
      p_lines: clean,
      p_idempotency_key: key,
      p_fx_rate: rate,
      p_line_currency: lineCurrency,
      ...(occurredAt ? { p_occurred_at: occurredAt } : {}),
    });
    if (result.error || !result.data) {
      console.error("commitPurchaseItems: RPC failed", { message: result.error?.message, lines: clean.length });
      const code = failureCode(result.error?.message);
      return { error: code === "invalid_currency" ? "rate" : code, attempt };
    }
    purchaseId = result.data as string;
    await saveRecordNote(db, organizationId, "purchase", purchaseId, noteInput(form.get("note")));
    await dropDraft(form);
  } catch (error) {
    unstable_rethrow(error);
    console.error("commitPurchaseItems: unexpected failure", error);
    return { error: "save", attempt };
  }
  revalidatePath("/", "layout");
  redirect(`/money/done/purchase/${purchaseId}`);
}
