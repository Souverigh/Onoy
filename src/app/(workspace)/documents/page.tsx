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
