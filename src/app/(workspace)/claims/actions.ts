"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { decimalInput } from "@/lib/validation";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function confirmClaim(form: FormData) {
  const id = String(form.get("id") ?? "");
  const amount = String(form.get("amount") ?? "");
  if (!uuidPattern.test(id)) redirect("/claims?error=invalid");
  let value: string;
  try {
    value = decimalInput(amount, 2);
  } catch {
    redirect("/claims?error=invalid");
  }
  const { db, organizationId } = await getContext();
  const result = await db.rpc("confirm_payment_claim", {
    p_org: organizationId,
    p_payment: id,
    p_amount: value,
  });
  if (result.error) redirect("/claims?error=invalid");
  revalidatePath("/", "layout");
  redirect("/claims?done=confirmed");
}

export async function rejectClaim(form: FormData) {
  const id = String(form.get("id") ?? "");
  const comment = String(form.get("comment") ?? "").trim();
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
