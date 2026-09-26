import Link from "next/link";
import { getContext } from "@/lib/context";
import { Icon } from "@/components/icon";

type DocRow = {
  id: string;
  kind: "purchase" | "sale" | "payment" | null;
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
};

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
  const parties = await partiesOf(db, organizationId, documents.map((d) => d.id));

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ФОТО → РАСПОЗНАВАНИЕ → ПРОВЕРКА</span>
          <h1>Документы</h1>
          <p className="muted">
            Накладные и чеки, приложенные к операциям. Долг они не меняют — это
            уже случилось при подтверждении операции.
          </p>
        </div>
      </div>
      {documents.length ? (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Кто</th>
                  <th>Статус</th>
                  <th>Загружен</th>
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
                              {parties.get(doc.id)!.role === "customer" ? "клиент" : "поставщик"}
                            </small>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={status.className}>{status.label}</span>
                        {doc.status === "failed" && doc.error_message && (
                          <small>{doc.error_message}</small>
                        )}
                      </td>
                      <td>
                        {new Intl.DateTimeFormat("ru-RU", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Bishkek",
                        }).format(new Date(doc.created_at))}
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

type Party = { name: string; role: "customer" | "supplier" };

/** Контрагент записи, к которой приложен документ, — одним запросом на таблицу. */
async function partiesOf(
  db: Awaited<ReturnType<typeof getContext>>["db"],
  organizationId: string,
  documentIds: string[],
): Promise<Map<string, Party>> {
  const result = new Map<string, Party>();
  if (!documentIds.length) return result;
  const [purchases, sales, payments] = await Promise.all([
    db.from("purchases").select("document_id,supplier_id").eq("organization_id", organizationId).in("document_id", documentIds),
    db.from("sales").select("document_id,customer_id").eq("organization_id", organizationId).in("document_id", documentIds),
    db
      .from("payments")
      .select("document_id,customer_id,supplier_id")
      .eq("organization_id", organizationId)
      .in("document_id", documentIds),
  ]);
  const links: { documentId: string; id: string; role: Party["role"] }[] = [];
  for (const r of purchases.data ?? []) links.push({ documentId: r.document_id, id: r.supplier_id, role: "supplier" });
  for (const r of sales.data ?? []) links.push({ documentId: r.document_id, id: r.customer_id, role: "customer" });
  for (const r of payments.data ?? []) {
    if (r.customer_id) links.push({ documentId: r.document_id, id: r.customer_id, role: "customer" });
    else if (r.supplier_id) links.push({ documentId: r.document_id, id: r.supplier_id, role: "supplier" });
  }
  const ids = (role: Party["role"]) => [...new Set(links.filter((l) => l.role === role).map((l) => l.id))];
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
