import type { SupabaseClient } from "@supabase/supabase-js";
import { convertAmount, isCurrency, ratePair, type Currency } from "@/lib/currency";
import type { RateQuote } from "@/lib/fx";

/** Сумма и валюта, распознанные на чеке заявки. */
export type ReceiptAmount = { amount: number; currency: Currency };

/** Последнее распознавание чека по каждому документу (document_extractions). */
export async function receiptAmounts(
  db: SupabaseClient,
  organizationId: string,
  documentIds: string[],
): Promise<Map<string, ReceiptAmount>> {
  const result = new Map<string, ReceiptAmount>();
  if (!documentIds.length) return result;
  const { data } = await db
    .from("document_extractions")
    .select("document_id,payload")
    .eq("organization_id", organizationId)
    .in("document_id", documentIds)
    .order("created_at", { ascending: false });
  for (const e of data ?? []) {
    const payload = e.payload as { kind?: string; extracted?: { amount?: number; currency?: string } } | null;
    if (payload?.kind !== "receipt" || result.has(e.document_id)) continue;
    const amount = Number(payload.extracted?.amount);
    const currency = payload.extracted?.currency;
    if (amount > 0) result.set(e.document_id, { amount, currency: isCurrency(currency) ? currency : "KGS" });
  }
  return result;
}

export type ReceiptCheck = {
  receipt: ReceiptAmount;
  /** Сумма чека в валюте долга; null — курс неизвестен. */
  inDebt: number | null;
  /** По чеку минус заявка, в валюте долга: > 0 — по чеку больше. */
  diff: number | null;
};

/**
 * Сверка суммы заявки с чеком в валюте долга. Чек в другой валюте —
 * по курсу самой заявки (если клиент указал ту же валюту), иначе по
 * официальному курсу из `rates` (ключ «сильная/слабая», как officialRates).
 */
export function checkReceipt(
  claim: { amount: string | number; original_currency?: string | null; fx_rate?: string | number | null },
  debtCurrency: Currency,
  receipt: ReceiptAmount,
  rates: Record<string, RateQuote> = {},
): ReceiptCheck {
  let inDebt: number | null = null;
  if (receipt.currency === debtCurrency) inDebt = receipt.amount;
  else {
    const rate =
      claim.original_currency === receipt.currency && Number(claim.fx_rate) > 0
        ? Number(claim.fx_rate)
        : rates[ratePair(receipt.currency, debtCurrency).join("/")]?.rate;
    if (rate) inDebt = convertAmount(receipt.amount, receipt.currency, debtCurrency, rate);
  }
  const diff = inDebt == null ? null : Math.round((inDebt - Number(claim.amount)) * 100) / 100;
  return { receipt, inDebt, diff };
}

/** Расхождение больше 1 (сом/рубль/доллар) — как TOLERANCE у накладных. */
export const receiptDiffers = (check: ReceiptCheck) => check.diff == null || Math.abs(check.diff) > 1;
