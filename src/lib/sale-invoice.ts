import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { money } from "./format";

export type SaleInvoiceInfo = {
  number: number | null;
  /** Номер с фото накладной, если распознан. */
  paperNumber: string | null;
  debtAfter: string | null;
  customerPhone: string;
  sellerName: string | null;
  /** Из Настроек → Магазин (задача 34); пусто — имя продавца из сотрудников и телефон магазина. */
  shopSellerName: string | null;
  shopSellerPhone: string | null;
  /** «Долг после этой накладной» и QR — включаются в Настройках, по умолчанию да. */
  showDebt: boolean;
  showQr: boolean;
};

/** Номер, долг после накладной, продавец — для PDF (sale_invoice_info). */
export function parseSaleInvoiceInfo(raw: unknown): SaleInvoiceInfo {
  const data = (raw ?? {}) as Record<string, unknown>;
  return {
    number: typeof data.number === "number" ? data.number : null,
    paperNumber: typeof data.paper_number === "string" && data.paper_number.trim() ? data.paper_number.trim() : null,
    debtAfter: typeof data.debt_after === "string" ? data.debt_after : null,
    customerPhone: typeof data.customer_phone === "string" ? data.customer_phone : "",
    sellerName: typeof data.seller_name === "string" ? data.seller_name : null,
    shopSellerName: typeof data.shop_seller_name === "string" && data.shop_seller_name ? data.shop_seller_name : null,
    shopSellerPhone: typeof data.shop_seller_phone === "string" && data.shop_seller_phone ? data.shop_seller_phone : null,
    showDebt: data.show_debt !== false,
    showQr: data.show_qr !== false,
  };
}

export async function saleInvoiceInfo(db: SupabaseClient, organizationId: string, saleId: string) {
  // Миграция ещё не применена — накладная без номера и долга, но печатается.
  const { data, error } = await db.rpc("sale_invoice_info", { p_org: organizationId, p_sale: saleId });
  return parseSaleInvoiceInfo(error ? null : data);
}

/** Действующая ссылка клиента, без создания новой. */
export async function activeShareToken(db: SupabaseClient, organizationId: string, customerId: string) {
  const { data } = await db
    .from("share_links")
    .select("token")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.token as string | undefined) ?? null;
}

export function balanceNote(debtAfter: string | null, currency: string) {
  if (debtAfter == null) return null;
  return debtAfter.startsWith("-")
    ? `Аванс покупателя после этой накладной: ${money(debtAfter.slice(1), currency)}`
    : `Долг покупателя после этой накладной: ${money(debtAfter, currency)}`;
}
