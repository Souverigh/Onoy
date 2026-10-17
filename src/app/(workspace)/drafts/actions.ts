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

/** Ошибка correct_sale / correct_purchase → код для экрана записи. */
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

/**
 * «Исправить продажу» (просьба пользователя 17.10.2026): старая продажа
 * отменяется (остаётся в истории, долг и склад возвращаются), а всё из неё —
 * клиент, строки, количество, цены, сумма, дата — переносится в новую форму,
 * как при новой продаже. Отмена и копия фото со всеми страницами — одним
 * шагом в базе (correct_sale): не вышло одно — не меняется ничего.
 */
export async function correctSale(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/sales");
  const back = fixBack(form, `/money/send/${id}`);
  const { db, organizationId, isOwner, user, currency: shopCurrency } = await getContext();
  const saleResult = await db
    .from("sales")
    .select(
      "id,customer_id,status,is_opening,document_id,reversed_at,paid_immediately,total,occurred_at,created_at,created_by,original_amount,original_currency,fx_rate,customers(name,currency)",
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
    original_amount: string | null;
    original_currency: string | null;
    fx_rate: string | null;
    customers: { name: string; currency: string | null } | null;
  } | null;
  if (!sale || sale.status !== "posted" || sale.is_opening || sale.reversed_at) redirect(`${back}?error=fix`);
  // Отменить может владелец; продавец — свою продажу в первые 2 минуты (база проверит ещё раз).
  const ownRecent = sale.created_by === user.id && Date.now() - Date.parse(sale.created_at) < 2 * 60 * 1000;
  if (!isOwner && !ownRecent) redirect(`${back}?error=fix_owner`);
  const day = bishkekDate(sale.occurred_at);
  const otherDay = day === bishkekDate() ? "" : day;

  // По фото: новая форма по фото с копией фото (все страницы); строки, сумму,
  // дату и выбор товаров склада форма возьмёт из этой (отменённой) продажи.
  if (sale.document_id) {
    const corrected = await db.rpc("correct_sale", { p_org: organizationId, p_sale: sale.id });
    if (corrected.error || !corrected.data) {
      console.error("correctSale: correct_sale failed", { message: corrected.error?.message });
      redirect(`${back}?error=${fixError(corrected.error?.message)}`);
    }
    revalidatePath("/", "layout");
    redirect(correctionHref("sale", { ...sale, party_id: sale.customer_id }, String(corrected.data)));
  }

  // Товарами со склада: те же товары черновиком — сначала черновик, потом
  // отмена; не вышло отменить — черновик стираем, продажа остаётся.
  const itemsResult = await db
    .from("sale_items")
    .select("product_id,qty,price")
    .eq("organization_id", organizationId)
    .eq("sale_id", sale.id)
    .order("n");
  const items = (itemsResult.data ?? []) as { product_id: string; qty: string; price: string }[];
  if (itemsResult.error || !items.length) redirect(`${back}?error=fix`);
  const lines = await draftLines(db, organizationId, items);
  if (!lines) redirect(`${back}?error=fix`);

  // Строки продажи со склада — в валюте магазина (в другой валюте — её исходная).
  const lineCurrency = sale.original_currency ?? shopCurrency;
  const total = items.reduce((s, i) => s + Math.round(Number(i.qty) * Number(i.price) * 100) / 100, 0);
  const draft = await db.rpc("save_record_draft", {
    p_org: organizationId,
    p_id: null,
    p_kind: "sale",
    p_data: {
      party: sale.customer_id,
      partyName: sale.customers?.name ?? "",
      lines,
      paidNow: sale.paid_immediately,
      // Продажа была не сегодня — исправленная запишется тем же днём.
      recordDate: otherDay,
      rate: sale.original_currency && sale.fx_rate ? asInput(sale.fx_rate) : "",
      total: total.toFixed(2),
      currency: lineCurrency,
    },
  });
  if (draft.error || !draft.data) {
    console.error("correctSale: draft failed", { message: draft.error?.message });
    redirect(`${back}?error=fix`);
  }
  const draftId = draft.data as string;
  const corrected = await db.rpc("correct_sale", { p_org: organizationId, p_sale: sale.id });
  if (corrected.error) {
    console.error("correctSale: correct_sale failed", { message: corrected.error.message });
    await db.rpc("delete_record_draft", { p_org: organizationId, p_id: draftId });
    redirect(`${back}?error=${fixError(corrected.error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/money/new?type=sale&mode=items&draft=${draftId}&fixed=1`);
}

/**
 * «Исправить приход» — как «Исправить продажу»: старый приход отменяется
 * (вместе с «Сразу оплатили поставщику»), всё из него — поставщик, строки,
 * сумма, дата, оплата — переносится в новую форму. Отмена и копия фото со
 * всеми страницами — одним шагом в базе (correct_purchase).
 */
export async function correctPurchase(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/purchases");
  const back = fixBack(form, `/purchases/${id}`);
  const { db, organizationId, isOwner, user, currency: shopCurrency } = await getContext();
  const purchaseResult = await db
    .from("purchases")
    .select(
      "id,supplier_id,status,is_opening,document_id,reversed_at,total,occurred_at,created_at,created_by,original_amount,original_currency,suppliers(name,currency)",
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
    original_amount: string | null;
    original_currency: string | null;
    suppliers: { name: string; currency: string | null } | null;
  } | null;
  if (!purchase || purchase.status !== "posted" || purchase.is_opening || purchase.reversed_at) redirect(`${back}?error=fix`);
  // Отменить может владелец; продавец — свой приход в первые 2 минуты (база проверит ещё раз).
  const ownRecent = purchase.created_by === user.id && Date.now() - Date.parse(purchase.created_at) < 2 * 60 * 1000;
  if (!isOwner && !ownRecent) redirect(`${back}?error=fix_owner`);
  const day = bishkekDate(purchase.occurred_at);
  const otherDay = day === bishkekDate() ? "" : day;
  // «Сразу оплатили поставщику» — отменяется вместе с приходом и переносится в форму.
  const part = await partPaymentOf(db, organizationId, purchase);
  const correct = () =>
    db.rpc("correct_purchase", { p_org: organizationId, p_purchase: purchase.id, p_payment: part?.id ?? null });

  // По фото: форма по фото с копией фото (все страницы); строки и сумму форма
  // возьмёт из этого (отменённого) прихода, без повторного чтения фото.
  if (purchase.document_id) {
    const corrected = await correct();
    if (corrected.error || !corrected.data) {
      console.error("correctPurchase: correct_purchase failed", { message: corrected.error?.message });
      redirect(`${back}?error=${fixError(corrected.error?.message)}`);
    }
    revalidatePath("/", "layout");
    redirect(correctionHref("purchase", { ...purchase, party_id: purchase.supplier_id }, String(corrected.data), part?.amount));
  }

  // Товарами на склад: те же товары черновиком — сначала черновик, потом
  // отмена; не вышло отменить — черновик стираем, приход остаётся.
  const itemsResult = await db
    .from("purchase_items")
    .select("product_id,qty,price")
    .eq("organization_id", organizationId)
    .eq("purchase_id", purchase.id)
    .order("n");
  const items = (itemsResult.data ?? []) as { product_id: string; qty: string; price: string }[];
  if (itemsResult.error || !items.length) redirect(`${back}?error=fix`);
  const lines = await draftLines(db, organizationId, items);
  if (!lines) redirect(`${back}?error=fix`);
  // Цены прихода — в валюте поставщика.
  const lineCurrency = purchase.suppliers?.currency ?? shopCurrency;
  const total = items.reduce((s, i) => s + Math.round(Number(i.qty) * Number(i.price) * 100) / 100, 0);
  const draft = await db.rpc("save_record_draft", {
    p_org: organizationId,
    p_id: null,
    p_kind: "purchase",
    p_data: {
      party: purchase.supplier_id,
      partyName: purchase.suppliers?.name ?? "",
      lines,
      paidNow: false,
      recordDate: otherDay,
      rate: "",
      total: total.toFixed(2),
      currency: lineCurrency,
    },
  });
  if (draft.error || !draft.data) {
    console.error("correctPurchase: draft failed", { message: draft.error?.message });
    redirect(`${back}?error=fix`);
  }
  const draftId = draft.data as string;
  const corrected = await correct();
  if (corrected.error) {
    console.error("correctPurchase: correct_purchase failed", { message: corrected.error.message });
    await db.rpc("delete_record_draft", { p_org: organizationId, p_id: draftId });
    redirect(`${back}?error=${fixError(corrected.error.message)}`);
  }
  revalidatePath("/", "layout");
  redirect(`/money/new?type=purchase&mode=items&draft=${draftId}&fixed=1${part ? `&part=${Number(part.amount)}` : ""}`);
}
