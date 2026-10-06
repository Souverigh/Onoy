"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";
import { isCurrency, rateInput } from "@/lib/currency";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Подтверждение заявки: как есть (без суммы), с исправленной суммой в валюте
 * долга, или — у оплаты в другой валюте — с исходной суммой и курсом (сумма
 * в валюте долга пересчитывается в базе, исходная валюта остаётся).
 */
export async function confirmClaim(form: FormData) {
  const id = String(form.get("id") ?? "");
  if (!uuidPattern.test(id)) redirect("/claims?error=invalid");
  const rawAmount = String(form.get("amount") ?? "").trim();
  const originalCurrency = form.get("original_currency");
  let params: Record<string, string | null> = { p_amount: null };
  try {
    if (isCurrency(originalCurrency)) {
      const rate = rateInput(String(form.get("fx_rate") ?? ""));
      if (!rate) throw new Error("rate");
      params = {
        p_amount: null,
        p_original_amount: decimalInput(form.get("original_amount"), 2),
        p_original_currency: originalCurrency,
        p_fx_rate: rate,
      };
    } else if (rawAmount) {
      params = { p_amount: decimalInput(rawAmount, 2) };
    }
  } catch {
    redirect("/claims?error=invalid");
  }
  const { db, organizationId } = await getContext();
  const result = await db.rpc("confirm_payment_claim", {
    p_org: organizationId,
    p_payment: id,
    ...params,
  });
  if (result.error) redirect("/claims?error=invalid");
  revalidatePath("/", "layout");
  // 5 секунд «Вернуть» (задача 19).
  redirect(`/claims?done=confirmed&undo=${id}`);
}

/** «Вернуть» сразу после подтверждения: заявка снова ждёт, долг как был. */
export async function undoConfirmClaim(id: string): Promise<{ ok: boolean }> {
  if (!uuidPattern.test(id)) return { ok: false };
  const { db, organizationId } = await getContext();
  const result = await db.rpc("undo_confirm_claim", { p_org: organizationId, p_payment: id });
  if (result.error) return { ok: false };
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Причины отказа кнопками (задача 19) или своим текстом. */
export async function rejectClaim(form: FormData) {
  const id = String(form.get("id") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  const text = String(form.get("comment") ?? "").trim();
  const comment = (reason && text ? `${reason}: ${text}` : reason || text).slice(0, 500);
  if (!uuidPattern.test(id) || !comment) redirect("/claims?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("reject_payment_claim", {
    p_org: organizationId,
    p_payment: id,
    p_comment: comment,
  });
  if (result.error) redirect("/claims?error=invalid");
  revalidatePath("/", "layout");
  redirect("/claims?done=rejected");
}
