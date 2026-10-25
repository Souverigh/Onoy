"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import type { DraftData } from "@/lib/drafts";
import { storedPhone } from "@/lib/contacts";
import { phoneText } from "@/lib/format";
import { linkedCustomers, matchOrder, phoneBook, type CatalogOrder, type OrderCustomer } from "@/lib/catalog-orders";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** «85.50» → «85,5» — как в полях формы. */
const asInput = (value: string | number) => String(Number(value)).replace(".", ",");

type Db = Awaited<ReturnType<typeof getContext>>["db"];

/**
 * На кого продажа по заказу. choice: "" — как узнали (личная страница или
 * единственный клиент с этим телефоном); id — выбранный продавцом клиент;
 * "new" — новый покупатель: клиент с именем и телефоном из заказа (если
 * клиент с этим телефоном уже появился — он, без дубля); "pick" — выбрать в
 * форме. null — без клиента; "error" — не получилось создать.
 */
async function saleCustomer(
  db: Db,
  organizationId: string,
  order: Pick<CatalogOrder, "customer_id" | "buyer_name" | "buyer_phone">,
  choice: string,
): Promise<OrderCustomer | null | "error"> {
  if (choice === "pick") return null;
  if (uuidPattern.test(choice)) {
    const picked = await db
      .from("customers")
      .select("id,name")
      .eq("organization_id", organizationId)
      .eq("id", choice)
      .is("merged_into_id", null)
      .maybeSingle();
    return (picked.data as OrderCustomer | null) ?? null;
  }
  const linked = await linkedCustomers(db, organizationId, order.customer_id ? [order.customer_id] : []);
  const match = matchOrder(order, await phoneBook(db, organizationId), linked);
  if (match.kind === "one") return match.customer;
  if (choice !== "new" || match.kind === "many" || !order.buyer_phone) return null;
  const phone = storedPhone(order.buyer_phone).slice(0, 40);
  const name = (order.buyer_name?.trim() || phoneText(phone)).slice(0, 160);
  const inserted = await db.from("customers").insert({ organization_id: organizationId, name, phone }).select("id,name").single();
  if (inserted.error || !inserted.data) {
    console.error("makeSaleFromOrder: customer failed", { message: inserted.error?.message });
    return "error";
  }
  revalidatePath("/customers");
  return inserted.data as OrderCustomer;
}

/**
 * «Сделать продажу» по заказу из каталога (задача № 12): черновик продажи
 * товарами — те же товары, количество и цены заказа, клиент (узнанный,
 * выбранный или новый — saleCustomer), комментарий клиента; дальше обычная
 * форма «Товары со склада». Записали — заказ «Продан» (commitSaleItems →
 * complete_catalog_order).
 */
export async function makeSaleFromOrder(form: FormData) {
  const id = String(form.get("id") ?? "");
  const choice = String(form.get("customer") ?? "");
  if (!uuidPattern.test(id)) redirect("/orders");
  const { db, organizationId, currency } = await getContext();
  const orderResult = await db
    .from("catalog_orders")
    .select("id,status,customer_id,buyer_name,buyer_phone,note,items")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const order = orderResult.data as Pick<CatalogOrder, "id" | "status" | "customer_id" | "buyer_name" | "buyer_phone" | "note" | "items"> | null;
  if (!order || (order.status !== "new" && order.status !== "accepted")) redirect("/orders?error=handled");

  // Товар — снимком со склада, как в других черновиках; убранный со склада пропускаем.
  const productsResult = await db
    .from("product_balances")
    .select("id,name,sku,unit,sale_price,purchase_price,purchase_currency,stock,aliases,sold_count")
    .eq("organization_id", organizationId)
    .in("id", [...new Set(order.items.map((i) => i.product_id))]);
  const products = new Map((productsResult.data ?? []).map((p) => [p.id as string, p]));
  const lines = order.items
    .filter((i) => products.has(i.product_id))
    .map((i) => ({ product: products.get(i.product_id), qty: asInput(i.qty), price: asInput(i.price) }));
  if (!lines.length) redirect("/orders?error=products");
  const total = lines.reduce((s, l) => s + Math.round(Number(l.qty.replace(",", ".")) * Number(l.price.replace(",", ".")) * 100) / 100, 0);
  const found = await saleCustomer(db, organizationId, order, choice);
  if (found === "error") redirect("/orders?error=customer");
  const customer = found;
  const who = [order.buyer_name, order.buyer_phone].filter(Boolean).join(", ");
  const data: DraftData = {
    party: customer?.id ?? "",
    partyName: customer?.name ?? "",
    lines: lines as DraftData["lines"],
    paidNow: false,
    recordDate: "",
    rate: "",
    total: total.toFixed(2),
    currency,
    note: ["Заказ из каталога", !customer && who ? who : null, order.note].filter(Boolean).join(". ").slice(0, 500),
  };
  const draft = await db.rpc("save_record_draft", { p_org: organizationId, p_id: null, p_kind: "sale", p_data: data });
  if (draft.error || !draft.data) {
    console.error("makeSaleFromOrder: draft failed", { message: draft.error?.message });
    redirect(`/orders?error=${draft.error?.message.includes("too_many_drafts") ? "drafts" : "save"}`);
  }
  const draftId = String(draft.data);
  const accepted = await db.rpc("accept_catalog_order", { p_org: organizationId, p_id: order.id, p_draft: draftId });
  if (accepted.error) {
    // Заказ уже продали или убрали с другого телефона — черновик не нужен.
    await db.rpc("delete_record_draft", { p_org: organizationId, p_id: draftId });
    console.error("makeSaleFromOrder: accept failed", { message: accepted.error.message });
    const message = accepted.error.message;
    redirect(`/orders?error=${message.includes("order_handled") ? "handled" : message.includes("order_in_progress") ? "progress" : "save"}`);
  }
  revalidatePath("/", "layout");
  redirect(`/money/new?type=sale&mode=items&draft=${draftId}&order=${lines.length < order.items.length ? "missing" : "1"}`);
}

/** «Убрать» заказ / «Вернуть» убранный. */
export async function setOrderDismissed(form: FormData) {
  const id = String(form.get("id") ?? "");
  const dismissed = form.get("dismissed") === "true";
  if (!uuidPattern.test(id)) redirect("/orders");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("set_catalog_order_dismissed", { p_org: organizationId, p_id: id, p_dismissed: dismissed });
  if (result.error) {
    console.error("setOrderDismissed failed", { message: result.error.message });
    redirect(`/orders?error=${result.error.message.includes("order_handled") ? "handled" : "save"}`);
  }
  revalidatePath("/", "layout");
  redirect(dismissed ? `/orders?dismissed=${id}` : "/orders");
}
