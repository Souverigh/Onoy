"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { decimalInput } from "@/lib/validation";
import { uploadClaimPhoto } from "@/lib/storage";
import { documentMimeType } from "@/lib/pages";
import { noteClaimReceipt } from "@/lib/adre/recognize";

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
  // Номер перевода с квитанции — после ответа клиенту: если он уже есть в
  // оплате магазина, заявка помечается «Дубликат» (видят продавец и владелец).
  const paymentId = typeof result.data === "string" ? result.data : null;
  if (paymentId && documentId && photo instanceof File) {
    const buffer = Buffer.from(await photo.arrayBuffer());
    const mimeType = documentMimeType(photo);
    after(() => noteClaimReceipt({ anon, token, paymentId, photo: buffer, mimeType }));
  }
  redirect(`/c/${token}?claimed=1`);
}
