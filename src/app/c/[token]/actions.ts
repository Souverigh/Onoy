"use server";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { decimalInput } from "@/lib/validation";
import { uploadClaimPhoto } from "@/lib/storage";
import { documentMimeType } from "@/lib/pages";
import { noteClaimReceipt, recognizeClaimReceipt, type ClaimReceipt } from "@/lib/adre/recognize";
import { isCurrency, ratePair, type Currency } from "@/lib/currency";
import { officialRates } from "@/lib/fx";

export async function submitClaim(form: FormData) {
  const token = String(form.get("token") ?? "");
  if (!/^[a-f0-9]{32}$/i.test(token)) redirect("/");
  const photo = form.get("photo");
  const hasPhoto = photo instanceof File && photo.size > 0;
  // Сумму можно не вводить, если приложен чек, — прочитаем её с чека.
  const rawAmount = String(form.get("amount") ?? "").trim();
  let amount: string | null = null;
  if (rawAmount) {
    try {
      amount = decimalInput(rawAmount, 2);
    } catch {
      redirect(`/c/${token}?error=invalid`);
    }
  } else if (!hasPhoto) {
    redirect(`/c/${token}?error=amount`);
  }
  const comment = String(form.get("comment") ?? "").trim().slice(0, 2000);
  const anon = createAnonClient();
  let currency: Currency | null = isCurrency(form.get("currency")) ? (form.get("currency") as Currency) : null;

  let documentId: string | null = null;
  let buffer: Buffer | null = null;
  let mimeType = "";
  if (hasPhoto) {
    try {
      documentId = await uploadClaimPhoto(anon, token, photo);
    } catch {
      redirect(`/c/${token}?error=photo`);
    }
    buffer = Buffer.from(await photo.arrayBuffer());
    mimeType = documentMimeType(photo);
  }

  // Суммы нет — распознаём чек сейчас (клиент подождёт пару секунд); этот же
  // результат потом уйдёт в note_claim_receipt, второй раз не платим.
  let receipt: ClaimReceipt | null = null;
  if (!amount && buffer) {
    receipt = await recognizeClaimReceipt(buffer, mimeType);
    const read = Number(receipt?.result.amount);
    if (!(read > 0) || read >= 1e14) redirect(`/c/${token}?error=unread`);
    amount = read.toFixed(2);
    if (isCurrency(receipt!.result.currency)) currency = receipt!.result.currency;
  }

  // Перевод в другой валюте: курс НБКР / ЦБ РФ на сегодня берёт сервер,
  // сумму в валюте долга считает база (submit_payment_claim).
  let original: { p_original_amount: string; p_original_currency: string; p_fx_rate: string } | null = null;
  if (currency) {
    const statement = await anon.rpc("get_statement_by_token", { p_token: token });
    const debtCurrency = (statement.data as { currency?: string } | null)?.currency;
    if (isCurrency(debtCurrency) && currency !== debtCurrency) {
      const [strong, weak] = ratePair(currency, debtCurrency);
      const quote = (await officialRates([currency, debtCurrency]))[`${strong}/${weak}`];
      if (!quote) redirect(`/c/${token}?error=rate`);
      original = { p_original_amount: amount!, p_original_currency: currency, p_fx_rate: String(quote.rate) };
    }
  }

  const result = await anon.rpc("submit_payment_claim", {
    p_token: token,
    p_amount: amount,
    p_comment: comment || null,
    p_receipt_document: documentId,
    ...(original ?? {}),
  });
  if (result.error) redirect(`/c/${token}?error=invalid`);
  // Номер перевода с квитанции — после ответа клиенту: если он уже есть в
  // оплате магазина, заявка помечается «Дубликат» (видят продавец и владелец).
  const paymentId = typeof result.data === "string" ? result.data : null;
  if (paymentId && documentId && buffer) {
    const photoBuffer = buffer;
    after(() => noteClaimReceipt({ anon, token, paymentId, photo: photoBuffer, mimeType, receipt }));
  }
  redirect(`/c/${token}?claimed=1${receipt ? "&fromReceipt=1" : ""}`);
}
