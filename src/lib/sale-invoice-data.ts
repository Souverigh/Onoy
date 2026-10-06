import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InvoiceData, InvoiceLine } from "./pdf/invoice";
import { money } from "./format";
import { partyCurrency, type Currency } from "./currency";
import { activeShareToken, balanceNote, saleInvoiceInfo } from "./sale-invoice";

/**
 * Накладная продажи для PDF и картинки (задачи 7, 8): строки — товары со
 * склада (sale_items) или распознанные строки фото (document_lines).
 * `checked` — можно отдавать клиенту: товары со склада или фото сверено.
 */
export async function saleInvoiceData(
  db: SupabaseClient,
  organizationId: string,
  saleId: string,
  origin: string,
  shopCurrency: Currency,
): Promise<{ data: InvoiceData; checked: boolean; reversed: boolean } | null> {
  const saleResult = await db
    .from("sales")
    .select("id,customer_id,total,occurred_at,original_amount,original_currency,fx_rate,document_id,reversed_at,is_opening,customers(name,currency)")
    .eq("organization_id", organizationId)
    .eq("id", saleId)
    .maybeSingle();
  const sale = saleResult.data as
    | {
        id: string;
        customer_id: string;
        total: string;
        occurred_at: string;
        original_amount: string | null;
        original_currency: string | null;
        fx_rate: string | null;
        document_id: string | null;
        reversed_at: string | null;
        is_opening: boolean;
        customers: { name: string; currency: string | null } | null;
      }
    | null;
  if (!sale || sale.is_opening) return null;
  const [itemsResult, docLines, doc, shop, info, token] = await Promise.all([
    db
      .from("sale_items")
      .select("n,name_snapshot,unit,qty,price,line_total")
      .eq("organization_id", organizationId)
      .eq("sale_id", sale.id)
      .order("n"),
    sale.document_id
      ? db
          .from("document_lines")
          .select("n,name_raw,qty,unit,price,sum")
          .eq("organization_id", organizationId)
          .eq("document_id", sale.document_id)
          .order("n")
      : Promise.resolve({ data: [] as InvoiceLine[] }),
    sale.document_id
      ? db.from("documents").select("status").eq("organization_id", organizationId).eq("id", sale.document_id).maybeSingle()
      : Promise.resolve({ data: null as { status: string } | null }),
    db.from("organizations").select("name,phone").eq("id", organizationId).maybeSingle(),
    saleInvoiceInfo(db, organizationId, sale.id),
    activeShareToken(db, organizationId, sale.customer_id),
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
  const debtCurrency = partyCurrency(sale.customers, shopCurrency);
  const shopName = shop.data?.name ?? "Магазин";
  const checked = (items.length > 0 || doc.data?.status === "digitized") && !sale.reversed_at;
  return {
    checked,
    reversed: Boolean(sale.reversed_at),
    data: {
      shopName,
      kindLabel: "Товарная накладная",
      number: info.paperNumber ?? info.number,
      occurredAt: sale.occurred_at,
      total: Number(sale.original_amount ?? sale.total),
      currency: sale.original_currency ?? debtCurrency,
      debtNote:
        sale.original_amount != null ? `В долг: ${money(sale.total, debtCurrency)} по курсу ${Number(sale.fx_rate)}.` : null,
      balanceNote: info.showDebt ? balanceNote(info.debtAfter, debtCurrency) : null,
      buyer: { name: sale.customers?.name ?? "—", phone: info.customerPhone },
      seller: {
        name: info.shopSellerName ?? info.sellerName ?? shopName,
        phone: info.shopSellerPhone ?? shop.data?.phone,
      },
      lines,
      clientUrl: info.showQr && token ? `${origin}/c/${token}` : null,
    },
  };
}
