import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceData, InvoiceLine } from "./pdf/invoice";
import { balanceNote, parseSaleInvoiceInfo } from "./sale-invoice";

type Invoice = {
  shop_name: string;
  shop_phone: string | null;
  customer_name: string;
  total: string;
  currency?: string;
  /** Валюта долга клиента (для строки «Долг после накладной»). */
  debt_currency?: string;
  occurred_at: string;
  lines: InvoiceLine[];
};

/**
 * Накладная для клиента по ссылке, без входа (PDF и картинка). Что можно
 * отдать, решает get_invoice_by_token: только сверенная продажа этого клиента.
 */
export async function tokenInvoiceData(
  anon: SupabaseClient,
  token: string,
  sale: string,
  origin: string,
): Promise<InvoiceData | null> {
  const { data, error } = await anon.rpc("get_invoice_by_token", { p_token: token, p_sale: sale });
  if (error || !data) return null;
  const invoice = data as Invoice;
  const info = parseSaleInvoiceInfo(invoice);
  const debtCurrency = invoice.debt_currency ?? invoice.currency ?? "KGS";
  return {
    shopName: invoice.shop_name ?? "Магазин",
    kindLabel: "Товарная накладная",
    number: info.paperNumber ?? info.number,
    occurredAt: invoice.occurred_at,
    total: Number(invoice.total),
    currency: invoice.currency ?? "KGS",
    balanceNote: info.showDebt ? balanceNote(info.debtAfter, debtCurrency) : null,
    buyer: { name: invoice.customer_name, phone: info.customerPhone },
    seller: {
      name: info.shopSellerName ?? info.sellerName ?? invoice.shop_name ?? "",
      phone: info.shopSellerPhone ?? invoice.shop_phone,
    },
    lines: invoice.lines,
    clientUrl: info.showQr ? `${origin}/c/${token}` : null,
  };
}
