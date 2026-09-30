import Link from "next/link";
import { getContext } from "@/lib/context";
import { Icon } from "@/components/icon";
import { expenseCategoryLabel } from "@/lib/expenses";

type DocRow = {
  id: string;
  kind: "purchase" | "sale" | "payment" | "expense" | null;
  status: string;
  error_message: string | null;
  created_at: string;
};

const statusLabel: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Ожидает", className: "tag" },
  processing: { label: "Распознаём…", className: "tag" },
  digitized: { label: "Оцифрована", className: "tag green" },
  review: { label: "Расхождение", className: "tag reversed-tag" },
  failed: { label: "Ошибка", className: "tag reversed-tag" },
};

const kindLabel: Record<string, string> = {
  purchase: "Приход",
  sale: "Продажа",
  payment: "Оплата",
  expense: "Расход",
};
const dateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bishkek",
});

// Список на телефоне — коротко, без года: «30.09, 07:59».
const shortDateTime = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bishkek",
});

const roleLabel = { customer: "клиент", supplier: "поставщик", expense: "расход магазина" } as const;

export default async function Documents() {
  const { db, organizationId } = await getContext();
  const { data, error } = await db
    .from("documents")
    .select("id,kind,status,error_message,created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Не удалось загрузить документы");
  const documents = (data ?? []) as DocRow[];
  const ids = documents.map((d) => d.id);
  const [parties, digitizedAt, duplicates] = await Promise.all([
    partiesOf(db, organizationId, ids),
    lastRecognition(db, organizationId, ids),
    duplicateDocuments(db, organizationId, ids),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ФОТО → РАСПОЗНАВАНИЕ → ПРОВЕРКА</span>
          <h1>Документы</h1>
          <p className="muted">
            Накладные и чеки, приложенные к операциям и расходам. Долг они не меняют — это
            уже случилось при подтверждении операции.
          </p>
        </div>
      </div>
      {documents.length ? (
        <section className="panel">
          {/* Телефон: компактный список — строка документа целиком нажимается. */}
          <ul className="doc-list-mobile">
            {documents.map((doc) => {
              const status = statusLabel[doc.status] ?? statusLabel.uploaded;
              const party = parties.get(doc.id);
              return (
                <li key={doc.id}>
                  <Link href={`/documents/${doc.id}`} className="doc-list-item">
                    <span className="doc-list-main">
                      <strong>{doc.kind ? kindLabel[doc.kind] : "Документ"}</strong>
                      {party ? (
                        <span className="doc-list-party">
                          {" · "}
                          {party.name} <small className="muted">{roleLabel[party.role]}</small>
                        </span>
                      ) : null}
                    </span>
                    <span className={status.className}>{status.label}</span>
                    <span className="doc-list-meta muted">
                      {shortDateTime.format(new Date(doc.created_at))}
                    </span>
                    {duplicates.has(doc.id) && <span className="tag duplicate-tag">дубликат</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="table-wrap doc-table">
            <table>
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Кто</th>
                  <th>Статус</th>
                  <th>Загружен</th>
                  <th>Оцифрован</th>
                  <th>
                    <span className="sr-only">Открыть</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const status = statusLabel[doc.status] ?? statusLabel.uploaded;
                  return (
                    <tr key={doc.id}>
                      <td>{doc.kind ? kindLabel[doc.kind] : "—"}</td>
                      <td>
                        {parties.get(doc.id) ? (
                          <span className="doc-party">
                            {parties.get(doc.id)!.name}
                            <small className="muted">
                              {roleLabel[parties.get(doc.id)!.role]}
                            </small>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={status.className}>{status.label}</span>
                        {duplicates.has(doc.id) && <span className="tag duplicate-tag">дубликат</span>}
                        {doc.status === "failed" && doc.error_message && (
                          <small>{doc.error_message}</small>
                        )}
                      </td>
                      <td>{dateTime.format(new Date(doc.created_at))}</td>
                      <td>
                        {(doc.status === "digitized" || doc.status === "review") && digitizedAt.get(doc.id) ? (
                          dateTime.format(new Date(digitizedAt.get(doc.id)!))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <Link href={`/documents/${doc.id}`} aria-label="Открыть документ">
                          <Icon name="arrow" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="camera" />
          </span>
          <h2>Документов пока нет</h2>
          <p>
            Фото появятся здесь после первого прихода или продажи с
            приложенным фото.
          </p>
        </div>
      )}
    </>
  );
}

type Db = Awaited<ReturnType<typeof getContext>>["db"];

/** Время последнего распознавания документа (строка document_extractions). */
async function lastRecognition(db: Db, organizationId: string, documentIds: string[]) {
  const result = new Map<string, string>();
  if (!documentIds.length) return result;
  const { data } = await db
    .from("document_extractions")
    .select("document_id,created_at")
    .eq("organization_id", organizationId)
    .in("document_id", documentIds)
    .order("created_at", { ascending: false })
    .limit(1000);
  for (const row of data ?? []) if (!result.has(row.document_id)) result.set(row.document_id, row.created_at);
  return result;
}

/** Чеки оплат-дубликатов, которые ещё ждут проверки владельца. */
async function duplicateDocuments(db: Db, organizationId: string, documentIds: string[]) {
  if (!documentIds.length) return new Set<string>();
  const { data } = await db
    .from("payments")
    .select("document_id")
    .eq("organization_id", organizationId)
    .in("document_id", documentIds)
    .not("duplicate_of", "is", null)
    .eq("status", "pending")
    .is("reversed_at", null);
  return new Set((data ?? []).map((r) => r.document_id as string));
}

type Party = { name: string; role: "customer" | "supplier" | "expense" };

/** Контрагент записи, к которой приложен документ, — одним запросом на таблицу. */
async function partiesOf(
  db: Awaited<ReturnType<typeof getContext>>["db"],
  organizationId: string,
  documentIds: string[],
): Promise<Map<string, Party>> {
  const result = new Map<string, Party>();
  if (!documentIds.length) return result;
  const [purchases, sales, payments, expenses] = await Promise.all([
    db.from("purchases").select("document_id,supplier_id").eq("organization_id", organizationId).in("document_id", documentIds),
    db.from("sales").select("document_id,customer_id").eq("organization_id", organizationId).in("document_id", documentIds),
    db
      .from("payments")
      .select("document_id,customer_id,supplier_id")
      .eq("organization_id", organizationId)
      .in("document_id", documentIds),
    db.from("expenses").select("document_id,category").eq("organization_id", organizationId).in("document_id", documentIds),
  ]);
  // Расход — без контрагента: показываем категорию.
  for (const r of expenses.data ?? [])
    if (r.document_id) result.set(r.document_id, { name: expenseCategoryLabel(r.category), role: "expense" });
  const links: { documentId: string; id: string; role: "customer" | "supplier" }[] = [];
  for (const r of purchases.data ?? []) links.push({ documentId: r.document_id, id: r.supplier_id, role: "supplier" });
  for (const r of sales.data ?? []) links.push({ documentId: r.document_id, id: r.customer_id, role: "customer" });
  for (const r of payments.data ?? []) {
    if (r.customer_id) links.push({ documentId: r.document_id, id: r.customer_id, role: "customer" });
    else if (r.supplier_id) links.push({ documentId: r.document_id, id: r.supplier_id, role: "supplier" });
  }
  const ids = (role: "customer" | "supplier") => [...new Set(links.filter((l) => l.role === role).map((l) => l.id))];
  const [customers, suppliers] = await Promise.all([
    ids("customer").length
      ? db.from("customers").select("id,name").eq("organization_id", organizationId).in("id", ids("customer"))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ids("supplier").length
      ? db.from("suppliers").select("id,name").eq("organization_id", organizationId).in("id", ids("supplier"))
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const names = new Map<string, string>();
  for (const c of customers.data ?? []) names.set("customer:" + c.id, c.name);
  for (const c of suppliers.data ?? []) names.set("supplier:" + c.id, c.name);
  for (const l of links) {
    const name = names.get(l.role + ":" + l.id);
    if (name) result.set(l.documentId, { name, role: l.role });
  }
  return result;
}
