import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceData, InvoiceLine } from "./pdf/invoice";
import { money } from "./format";
import { partyCurrency, type Currency } from "./currency";

/**
 * Приходная накладная для PDF (просьба пользователя 17.10.2026): строки —
 * товары прихода (purchase_items) или распознанные строки фото. Продавец —
 * поставщик, покупатель — магазин. Телефон поставщика — для WhatsApp.
 */
export async function purchaseInvoiceData(
  db: SupabaseClient,
  organizationId: string,
  purchaseId: string,
  shopCurrency: Currency,
): Promise<{ data: InvoiceData; supplierPhone: string | null; reversed: boolean } | null> {
  const purchaseResult = await db
    .from("purchases")
    .select("id,total,occurred_at,status,is_opening,original_amount,original_currency,fx_rate,document_id,reversed_at,suppliers(name,phone,currency)")
    .eq("organization_id", organizationId)
    .eq("id", purchaseId)
    .maybeSingle();
  const purchase = purchaseResult.data as
    | {
        id: string;
        total: string;
        occurred_at: string;
        status: string;
        is_opening: boolean;
        original_amount: string | null;
        original_currency: string | null;
        fx_rate: string | null;
        document_id: string | null;
        reversed_at: string | null;
        suppliers: { name: string; phone: string | null; currency: string | null } | null;
      }
    | null;
  if (!purchase || purchase.is_opening || purchase.status !== "posted") return null;
  const [itemsResult, docLines, shop] = await Promise.all([
    db
      .from("purchase_items")
      .select("n,name_snapshot,unit,qty,price,line_total")
      .eq("organization_id", organizationId)
      .eq("purchase_id", purchase.id)
      .order("n"),
    purchase.document_id
      ? db
          .from("document_lines")
          .select("n,name_raw,qty,unit,price,sum")
          .eq("organization_id", organizationId)
          .eq("document_id", purchase.document_id)
          .order("n")
      : Promise.resolve({ data: [] as InvoiceLine[] }),
    db.from("organizations").select("name,phone").eq("id", organizationId).maybeSingle(),
  ]);
  const items = itemsResult.data ?? [];
  const lines: InvoiceLine[] = items.length
    ? items.map((item, i) => ({
        n: item.n ?? i + 1,
        name_raw: item.name_snapshot,
        qty: String(item.qty),
        unit: item.unit ?? "шт",
        price: String(item.price),
        sum: String(item.line_total),
      }))
    : ((docLines.data ?? []) as InvoiceLine[]).map((l) => ({ ...l, qty: String(l.qty), price: String(l.price), sum: String(l.sum) }));
  const debtCurrency = partyCurrency(purchase.suppliers, shopCurrency);
  return {
    supplierPhone: purchase.suppliers?.phone ?? null,
    reversed: Boolean(purchase.reversed_at),
    data: {
      shopName: shop.data?.name ?? "Магазин",
      kindLabel: "Приходная накладная",
      number: null,
      occurredAt: purchase.occurred_at,
      total: Number(purchase.original_amount ?? purchase.total),
      currency: purchase.original_currency ?? debtCurrency,
      debtNote:
        purchase.original_amount != null
          ? `В долг: ${money(purchase.total, debtCurrency)} по курсу ${Number(purchase.fx_rate)}.`
          : null,
      balanceNote: null,
      buyer: { name: shop.data?.name ?? "Магазин", phone: shop.data?.phone },
      seller: { name: purchase.suppliers?.name ?? "-", phone: purchase.suppliers?.phone },
      lines,
      clientUrl: null,
    },
  };
}
