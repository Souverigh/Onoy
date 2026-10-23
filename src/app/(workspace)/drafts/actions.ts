"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { bishkekDate } from "@/lib/day-summary";
import { draftData, type DraftData, type DraftKind } from "@/lib/drafts";
import { partPaymentOf } from "@/lib/part-payment";
import { correctionHref } from "@/lib/correction";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Автосохранение формы продажи/прихода товарами. Без id — новый черновик.
 * «gone» — черновик уже записан или стёрт: форма перестаёт его сохранять.
 */
export async function saveDraft(
  kind: DraftKind,
  id: string | null,
  data: DraftData,
): Promise<{ id: string } | { error: "gone" | "save" }> {
  if (kind !== "sale" && kind !== "purchase") return { error: "save" };
  if (id && !uuidPattern.test(id)) return { error: "gone" };
  const { db, organizationId } = await getContext();
  const result = await db.rpc("save_record_draft", {
    p_org: organizationId,
    p_id: id,
    p_kind: kind,
    p_data: draftData(data),
  });
  if (result.error || !result.data) {
    if (result.error?.message.includes("draft_gone")) return { error: "gone" };
    console.error("saveDraft failed", { message: result.error?.message });
    return { error: "save" };
  }
  return { id: result.data as string };
}

/** Стереть черновик из списка «Продажи» / «Приход». */
export async function deleteDraft(form: FormData) {
  const id = form.get("id");
  const kind = form.get("kind") === "purchase" ? "purchase" : "sale";
  const back = kind === "sale" ? "/sales" : "/purchases";
  if (typeof id !== "string" || !uuidPattern.test(id)) redirect(back);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_record_draft", { p_org: organizationId, p_id: id });
  if (result.error) {
    console.error("deleteDraft failed", { message: result.error.message });
    redirect(`${back}?error=draft`);
  }
  revalidatePath(back);
  redirect(`${back}?deleted=1`);
}

/** «85.50» → «85,5» — как в полях формы. */
const asInput = (value: string | number) => String(Number(value)).replace(".", ",");

/** Ошибка start_correction → код для экрана записи. */
function fixError(message: string | undefined) {
  const text = message ?? "";
  return text.includes("has_returns") ? "fix_return" : text.includes("owner_only") ? "fix_owner" : "fix";
}

/** Куда вернуть с ошибкой: экран, с которого нажали «Исправить», иначе — запасной. */
function fixBack(form: FormData, fallback: string) {
  const back = String(form.get("back") ?? "");
  return /^\/(money\/send|purchases|documents)\/[0-9a-f-]{36}$/i.test(back) ? back : fallback;
}

/** Строки «товары со склада» для черновика: товар — снимком со склада, числа — как в полях. */
async function draftLines(
  db: Awaited<ReturnType<typeof getContext>>["db"],
  organizationId: string,
  items: { product_id: string; qty: string; price: string }[],
) {
  const productsResult = await db
    .from("product_balances")
    .select("id,name,sku,unit,sale_price,purchase_price,purchase_currency,stock,aliases,sold_count")
    .eq("organization_id", organizationId)
    .in("id", [...new Set(items.map((i) => i.product_id))]);
  const products = new Map((productsResult.data ?? []).map((p) => [p.id as string, p]));
  const lines = items
    .filter((i) => products.has(i.product_id))
    .map((i) => ({ product: products.get(i.product_id), qty: asInput(i.qty), price: asInput(i.price) }));
  return lines.length === items.length ? lines : null;
}

type Db = Awaited<ReturnType<typeof getContext>>["db"];
type SaleForDraft = {
  id: string;
  customer_id: string;
  paid_immediately: boolean;
  occurred_at: string;
  original_currency: string | null;
  fx_rate: string | null;
  customers: { name: string; currency: string | null } | null;
};
type PurchaseForDraft = {
  id: string;
  supplier_id: string;
  occurred_at: string;
  original_currency: string | null;
  fx_rate: string | null;
  suppliers: { name: string; currency: string | null } | null;
};

/** Запись была не сегодня — черновик запишется тем же днём. */
function draftDay(occurredAt: string) {
  const day = bishkekDate(occurredAt);
  return day === bishkekDate() ? "" : day;
}

/** Новый черновик из строк записи; null — строк нет, товар убран или не сохранилось. */
async function draftFromItems(
  db: Db,
  organizationId: string,
  kind: DraftKind,
  recordId: string,
  data: Omit<DraftData, "lines" | "total">,
): Promise<string | null> {
  const itemsResult = await db
    .from(kind === "sale" ? "sale_items" : "purchase_items")
    .select("product_id,qty,price")
    .eq("organization_id", organizationId)
    .eq(kind === "sale" ? "sale_id" : "purchase_id", recordId)
    .order("n");
  const items = (itemsResult.data ?? []) as { product_id: string; qty: string; price: string }[];
  if (itemsResult.error || !items.length) return null;
  const lines = await draftLines(db, organizationId, items);
  if (!lines) return null;
  const total = items.reduce((s, i) => s + Math.round(Number(i.qty) * Number(i.price) * 100) / 100, 0);
  const draft = await db.rpc("save_record_draft", {
    p_org: organizationId,
    p_id: null,
    p_kind: kind,
    p_data: { ...data, lines, total: total.toFixed(2) },
  });
  if (draft.error || !draft.data) {
    console.error("draftFromItems: save failed", { message: draft.error?.message, kind });
    return null;
  }
  return draft.data as string;
}

/** Продажа товарами со склада → черновик с тем же клиентом, товарами, ценами и днём. */
function saleDraft(db: Db, organizationId: string, sale: SaleForDraft, shopCurrency: string) {
  return draftFromItems(db, organizationId, "sale", sale.id, {
    party: sale.customer_id,
    partyName: sale.customers?.name ?? "",
    paidNow: sale.paid_immediately,
    recordDate: draftDay(sale.occurred_at),
    rate: sale.original_currency && sale.fx_rate ? asInput(sale.fx_rate) : "",
    // Строки продажи со склада — в валюте магазина (в другой валюте — её исходная).
    currency: sale.original_currency ?? shopCurrency,
    from: sale.id,
  });
}

/** Приход товарами → черновик с тем же поставщиком, товарами, ценами, валютой и днём. */
function purchaseDraft(db: Db, organizationId: string, purchase: PurchaseForDraft, shopCurrency: string) {
  return draftFromItems(db, organizationId, "purchase", purchase.id, {
    party: purchase.supplier_id,
    partyName: purchase.suppliers?.name ?? "",
    paidNow: false,
    recordDate: draftDay(purchase.occurred_at),
    rate: purchase.original_currency && purchase.fx_rate ? asInput(purchase.fx_rate) : "",
    // Цены прихода — в исходной валюте (выбранной в форме), иначе в валюте поставщика.
    currency: purchase.original_currency ?? purchase.suppliers?.currency ?? shopCurrency,
    from: purchase.id,
  });
}

/**
 * «Исправить продажу» (просьба пользователя 17.10.2026): всё из продажи —
 * клиент, строки, количество, цены, сумма, дата — переносится в новую форму.
 * Старая продажа пока действует: отменится в той же транзакции, что запишет
 * новую (commit_*_correction, 22.10.2026). Бросили исправление — ничего не
 * изменилось. Здесь — проверка прав и копия фото (start_correction).
 */
export async function correctSale(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/sales");
  const back = fixBack(form, `/money/send/${id}`);
  const { db, organizationId, isOwner, user, currency: shopCurrency } = await getContext();
  const saleResult = await db
    .from("sales")
    .select(
      "id,customer_id,status,is_opening,document_id,reversed_at,paid_immediately,total,occurred_at,created_at,created_by,maker_id,original_amount,original_currency,fx_rate,customers(name,currency)",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const sale = saleResult.data as unknown as {
    id: string;
    customer_id: string;
    status: string;
    is_opening: boolean;
    document_id: string | null;
    reversed_at: string | null;
    paid_immediately: boolean;
    total: string;
    occurred_at: string;
    created_at: string;
    created_by: string | null;
    maker_id: string | null;
    original_amount: string | null;
    original_currency: string | null;
    fx_rate: string | null;
    customers: { name: string; currency: string | null } | null;
  } | null;
  if (!sale || sale.status !== "posted" || sale.is_opening || sale.reversed_at) redirect(`${back}?error=fix`);
  // Исправить может владелец — любую запись, продавец — свою продажу в любое время (база проверит ещё раз).
  if (!isOwner && sale.maker_id !== user.id) redirect(`${back}?error=fix_owner`);

  const started = await db.rpc("start_correction", { p_org: organizationId, p_kind: "sale", p_id: sale.id });
  if (started.error) {
    console.error("correctSale: start_correction failed", { message: started.error.message });
    redirect(`${back}?error=${fixError(started.error.message)}`);
  }
  // По фото: форма по фото с копией фото (все страницы); строки, сумму, дату и
  // выбор товаров склада форма возьмёт из этой продажи.
  if (sale.document_id) {
    if (!started.data) redirect(`${back}?error=fix`);
    redirect(correctionHref("sale", { ...sale, party_id: sale.customer_id }, String(started.data), null, false, true));
  }
  // Товарами со склада: те же товары черновиком.
  const draftId = await saleDraft(db, organizationId, sale, shopCurrency);
  if (!draftId) redirect(`${back}?error=fix`);
  revalidatePath("/sales");
  redirect(`/money/new?type=sale&mode=items&draft=${draftId}&fixed=1`);
}

/**
 * «Исправить приход» — как «Исправить продажу»: всё из него — поставщик,
 * строки, сумма, дата, оплата — переносится в новую форму; старый приход
 * (вместе с «Сразу оплатили поставщику») отменится только при записи нового.
 */
export async function correctPurchase(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/purchases");
  const back = fixBack(form, `/purchases/${id}`);
  const { db, organizationId, isOwner, user, currency: shopCurrency } = await getContext();
  const purchaseResult = await db
    .from("purchases")
    .select(
      "id,supplier_id,status,is_opening,document_id,reversed_at,total,occurred_at,created_at,created_by,maker_id,original_amount,original_currency,fx_rate,suppliers(name,currency)",
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const purchase = purchaseResult.data as unknown as {
    id: string;
    supplier_id: string;
    status: string;
    is_opening: boolean;
    document_id: string | null;
    reversed_at: string | null;
    total: string;
    occurred_at: string;
    created_at: string;
    created_by: string | null;
    maker_id: string | null;
    original_amount: string | null;
    original_currency: string | null;
    fx_rate: string | null;
    suppliers: { name: string; currency: string | null } | null;
  } | null;
  if (!purchase || purchase.status !== "posted" || purchase.is_opening || purchase.reversed_at) redirect(`${back}?error=fix`);
  // Исправить может владелец — любую запись, продавец — свой приход в любое время (база проверит ещё раз).
  if (!isOwner && purchase.maker_id !== user.id) redirect(`${back}?error=fix_owner`);
  // «Сразу оплатили поставщику» — отменится вместе с приходом при записи
  // нового; сумма переносится в форму.
  const part = await partPaymentOf(db, organizationId, purchase);
  const started = await db.rpc("start_correction", { p_org: organizationId, p_kind: "purchase", p_id: purchase.id });
  if (started.error) {
    console.error("correctPurchase: start_correction failed", { message: started.error.message });
    redirect(`${back}?error=${fixError(started.error.message)}`);
  }
  // По фото: форма по фото с копией фото (все страницы); строки и сумму форма
  // возьмёт из этого прихода, без повторного чтения фото.
  if (purchase.document_id) {
    if (!started.data) redirect(`${back}?error=fix`);
    redirect(
      correctionHref("purchase", { ...purchase, party_id: purchase.supplier_id }, String(started.data), part?.amount, false, true),
    );
  }
  // Товарами на склад: те же товары черновиком.
  const draftId = await purchaseDraft(db, organizationId, purchase, shopCurrency);
  if (!draftId) redirect(`${back}?error=fix`);
  revalidatePath("/purchases");
  redirect(`/money/new?type=purchase&mode=items&draft=${draftId}&fixed=1${part ? `&part=${Number(part.amount)}` : ""}`);
}

/**
 * Отменённую запись — обратно (просьба пользователя 21.10.2026): продажа или
 * приход товарами открывается черновиком с тем же контрагентом, товарами,
 * ценами и днём; по фото — форма по фото с копией фото (все страницы) и
 * строками отменённой записи, как при «Исправить». Отменённая запись не
 * меняется и остаётся в истории; записали заново — появляется новая запись.
 */
export async function restoreAsDraft(form: FormData) {
  const id = String(form.get("id") ?? "");
  const kind: DraftKind = form.get("kind") === "purchase" ? "purchase" : "sale";
  if (!uuidPattern.test(id)) redirect(kind === "sale" ? "/sales" : "/purchases");
  const back = fixBack(form, kind === "sale" ? `/money/send/${id}` : `/purchases/${id}`);
  const { db, organizationId, currency: shopCurrency } = await getContext();
  const result =
    kind === "sale"
      ? await db
          .from("sales")
          .select("id,customer_id,status,document_id,reversed_at,paid_immediately,total,original_amount,occurred_at,original_currency,fx_rate,customers(name,currency)")
          .eq("organization_id", organizationId)
          .eq("id", id)
          .maybeSingle()
      : await db
          .from("purchases")
          .select("id,supplier_id,status,document_id,reversed_at,total,original_amount,occurred_at,original_currency,fx_rate,suppliers(name,currency)")
          .eq("organization_id", organizationId)
          .eq("id", id)
          .maybeSingle();
  const record = result.data as unknown as
    | (SaleForDraft &
        PurchaseForDraft & {
          status: string;
          document_id: string | null;
          reversed_at: string | null;
          total: string;
          original_amount: string | null;
        })
    | null;
  if (!record || record.status !== "posted" || !record.reversed_at) redirect(`${back}?error=restore`);

  // По фото: копия фото новым документом (restore_reversed_document), форма
  // по фото возьмёт строки и выбор товаров из отменённой записи по `from`.
  if (record.document_id) {
    const copy = await db.rpc("restore_reversed_document", { p_org: organizationId, p_kind: kind, p_record: record.id });
    if (copy.error || !copy.data) {
      console.error("restoreAsDraft: restore_reversed_document failed", { message: copy.error?.message });
      redirect(`${back}?error=restore`);
    }
    revalidatePath("/documents");
    const party = kind === "sale" ? record.customer_id : record.supplier_id;
    redirect(correctionHref(kind, { ...record, party_id: party }, String(copy.data), null, true));
  }

  const draftId =
    kind === "sale"
      ? await saleDraft(db, organizationId, record, shopCurrency)
      : await purchaseDraft(db, organizationId, record, shopCurrency);
  if (!draftId) redirect(`${back}?error=restore`);
  revalidatePath(kind === "sale" ? "/sales" : "/purchases");
  redirect(`/money/new?type=${kind}&mode=items&draft=${draftId}&restored=1`);
}
