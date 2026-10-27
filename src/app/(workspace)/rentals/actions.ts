"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { isCollateralKind, MAX_DAYS } from "@/lib/rentals";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Сумма из поля: «2 800» → «2800.00»; пусто — «0.00»; мусор — null. */
function amount(value: FormDataEntryValue | null): string | null {
  try {
    return decimalInput(String(value ?? "").trim() || "0", 2);
  } catch {
    return null;
  }
}

export type RentalState = { error?: string };

/**
 * «Выдать» (модуль «Прокат»): вещи, дни, сумма, оплата и залог одним
 * вызовом issue_rental — деньги продажей, залог деньгами в кассу.
 */
export async function issueRental(_: RentalState, form: FormData): Promise<RentalState> {
  const customer = String(form.get("customer_id") ?? "");
  if (!uuidPattern.test(customer)) return { error: "party" };
  const items: { product: string; price: string }[] = [];
  for (const raw of form.getAll("item")) {
    const [product, price] = String(raw).split(":");
    const p = amount(price ?? "");
    if (!uuidPattern.test(product ?? "") || p == null) return { error: "items" };
    items.push({ product, price: p });
  }
  if (!items.length || items.length > 50) return { error: "items" };
  const days = Number(form.get("days"));
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { error: "days" };
  const total = amount(form.get("amount"));
  const deposit = amount(form.get("deposit"));
  if (total == null || deposit == null) return { error: "amount" };
  // «Частично»: продажа в долг на всё, часть — оплатой сразу; часть меньше суммы.
  const pay = String(form.get("pay") ?? "paid");
  const part = pay === "part" ? amount(form.get("paid_now")) : null;
  if (pay === "part" && (part == null || !(Number(part) > 0) || Number(part) >= Number(total))) return { error: "part" };
  const kind = String(form.get("collateral_kind") ?? "");
  if (!isCollateralKind(kind)) return { error: "collateral" };
  const key = String(form.get("idempotency_key") ?? "");
  if (!uuidPattern.test(key)) return { error: "save" };

  const { db, organizationId } = await getContext();
  const result = await db.rpc("issue_rental", {
    p_org: organizationId,
    p_customer: customer,
    p_items: items,
    p_days: days,
    p_amount: total,
    p_paid: pay === "paid",
    p_collateral_kind: kind,
    p_collateral_note: String(form.get("collateral_note") ?? "").trim().slice(0, 100) || null,
    p_deposit: Number(deposit) > 0 ? deposit : null,
    p_note: String(form.get("note") ?? "").trim().slice(0, 500) || null,
    p_idempotency_key: key,
    ...(part ? { p_paid_now: part } : {}),
  });
  if (result.error || !result.data) {
    console.error("issueRental failed", { message: result.error?.message });
    const message = result.error?.message ?? "";
    return { error: message.includes("item_busy") ? "busy" : message.includes("invalid_customer") ? "party" : "save" };
  }
  revalidatePath("/", "layout");
  redirect(`/rentals/${result.data}?issued=1`);
}

/** «Вернул»: выбранные вещи или все; последняя — доплата и залог обратно. */
export async function returnRental(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/rentals");
  const items = form.getAll("item").map(String).filter((v) => uuidPattern.test(v));
  const extra = form.get("take_extra") === "1" ? amount(form.get("extra")) : "0.00";
  if (extra == null) redirect(`/rentals/${id}?error=amount`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("return_rental", {
    p_org: organizationId,
    p_rental: id,
    p_items: items.length ? items : null,
    p_extra: Number(extra) > 0 ? extra : null,
    p_extra_paid: form.get("extra_paid") === "true",
    p_deposit_back: form.get("deposit_back") === "1",
  });
  if (result.error) {
    console.error("returnRental failed", { message: result.error.message });
    redirect(`/rentals/${id}?error=save`);
  }
  revalidatePath("/", "layout");
  redirect(`/rentals/${id}?returned=${result.data ? "all" : "part"}`);
}

/** Залог деньгами не отдали при возврате — отдать сейчас. */
export async function returnDeposit(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/rentals");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("return_rental_deposit", { p_org: organizationId, p_rental: id });
  if (result.error) {
    console.error("returnDeposit failed", { message: result.error.message });
    redirect(`/rentals/${id}?error=save`);
  }
  revalidatePath("/", "layout");
  redirect(`/rentals/${id}?deposit=1`);
}

/** Отменить выдачу (ошиблись): владелец, с причиной; деньги и залог — тоже. */
export async function reverseRental(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/rentals");
  const comment = String(form.get("comment") ?? "").trim().slice(0, 500);
  if (!comment) redirect(`/rentals/${id}?error=reason`);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("reverse_rental", { p_org: organizationId, p_rental: id, p_comment: comment });
  if (result.error) {
    console.error("reverseRental failed", { message: result.error.message });
    redirect(`/rentals/${id}?error=${result.error.message.includes("owner_only") ? "owner" : "save"}`);
  }
  revalidatePath("/", "layout");
  redirect(`/rentals/${id}?reversed=1`);
}
