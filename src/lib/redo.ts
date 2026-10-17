import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type Operation = "purchase" | "sale" | "payment";

/**
 * Форма «Записать правильно» (задача 28): тот же клиент, та же сумма и то же
 * фото — фото берётся новым документом со всеми страницами (отменённая
 * запись держит старый),
 * распознавание — из кеша. Клиента в форме можно сменить.
 */
export async function redoTarget(db: SupabaseClient, organizationId: string, kind: Operation, id: string) {
  const table = kind === "sale" ? "sales" : kind === "purchase" ? "purchases" : "payments";
  const { data } = await db
    .from(table)
    .select(
      kind === "payment"
        ? "customer_id,supplier_id,direction,amount,original_amount,original_currency,document_id"
        : `${kind === "sale" ? "customer_id" : "supplier_id"},total,original_amount,original_currency,document_id`,
    )
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  const row = data as Record<string, string | null> | null;
  const params = new URLSearchParams({ type: kind });
  if (!row) return `/money/new?${params.toString()}`;
  const party = row.customer_id ?? row.supplier_id;
  if (party) params.set("party", party);
  if (kind === "payment" && row.direction) params.set("direction", row.direction);
  const amount = row.original_amount ?? row.total ?? row.amount;
  if (amount) params.set("amount", String(amount));
  if (row.original_currency) params.set("currency", row.original_currency);
  if (row.document_id) {
    const doc = await db
      .from("documents")
      .select("storage_path,file_hash,mime_type")
      .eq("organization_id", organizationId)
      .eq("id", row.document_id)
      .maybeSingle();
    if (doc.data) {
      const copy = await db.rpc("create_document", {
        p_org: organizationId,
        p_kind: kind,
        p_storage_path: doc.data.storage_path,
        p_file_hash: doc.data.file_hash,
        p_mime_type: doc.data.mime_type,
      });
      if (!copy.error && copy.data) {
        // Многостраничная накладная: страницы 2..N — тоже в новый документ
        // (add_document_pages ничего не делает, если они там уже есть).
        const pages = await db
          .from("document_pages")
          .select("storage_path,file_hash,mime_type")
          .eq("organization_id", organizationId)
          .eq("document_id", row.document_id)
          .order("page_no");
        if (pages.data?.length) {
          const added = await db.rpc("add_document_pages", {
            p_org: organizationId,
            p_document: copy.data,
            p_pages: pages.data,
          });
          if (added.error) console.error("redoTarget: add_document_pages failed", added.error);
        }
        params.set("documentId", String(copy.data));
      }
    }
  }
  params.set("redo", "1");
  return `/money/new?${params.toString()}`;
}
