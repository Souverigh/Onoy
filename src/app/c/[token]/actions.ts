"use server";
import { redirect } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { decimalInput } from "@/lib/validation";
import { uploadClaimPhoto } from "@/lib/storage";

export async function submitClaim(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{32}$/i.test(token)) redirect("/");
  let amount: string;
  try {
    amount = decimalInput(form.get("amount"), 2);
  } catch {
    redirect(`/c/${token}?error=invalid`);
  }
  const comment = String(form.get("comment") ?? "").trim().slice(0, 2000);
  const anon = createAnonClient();
  const photo = form.get("photo");
  let documentId: string | null = null;
  if (photo instanceof File && photo.size > 0) {
    try {
      documentId = await uploadClaimPhoto(anon, token, photo);
    } catch {
      redirect(`/c/${token}?error=photo`);
    }
  }
  const result = await anon.rpc("submit_payment_claim", {
    p_token: token,
    p_amount: amount,
    p_comment: comment || null,
    p_receipt_document: documentId,
  });
  if (result.error) redirect(`/c/${token}?error=invalid`);
  redirect(`/c/${token}?claimed=1`);
}
