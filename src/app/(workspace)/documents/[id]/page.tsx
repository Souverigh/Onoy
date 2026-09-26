import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { signedPhotoUrl } from "@/lib/storage";
import { retryRecognition, confirmDocument, updateLine } from "../actions";

type DocRow = {
  id: string;
  storage_path: string;
  status: string;
  kind: "purchase" | "sale" | "payment" | null;
  error_message: string | null;
  created_at: string;
};
type Line = {
  id: string;
  n: number;
  name_raw: string;
  qty: string;
  unit: string;
  price: string;
  sum: string;
  confidence: number | null;
};
type Extraction = {
  payload: { extracted?: Record<string, unknown> };
  provider: string;
  model_version: string;
  latency_ms: number | null;
  cost: number | null;
  created_at: string;
};

const TOLERANCE = 1;

export default async function DocumentDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; confirmed?: string; retried?: string; error?: string }>;
}) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
  const { db, organizationId } = await getContext();
  const params2 = await searchParams;

  const docResult = await db
    .from("documents")
    .select("id,storage_path,status,kind,error_message,created_at")
    .eq("organization_id", organizationId)
    .eq("id", id)
    .maybeSingle();
  if (docResult.error || !docResult.data) notFound();
  const doc = docResult.data as DocRow;

  const [linesResult, extractionResult] = await Promise.all([
    db
      .from("document_lines")
      .select("id,n,name_raw,qty,unit,price,sum,confidence")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("n"),
    db
      .from("document_extractions")
      .select("payload,provider,model_version,latency_ms,cost,created_at")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const lines = (linesResult.data ?? []) as Line[];
  const extraction = extractionResult.data as Extraction | null;

  let declaredTotal: number | null = null;
  if (doc.kind === "purchase") {
    const row = await db
      .from("purchases")
      .select("total,supplier_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? Number(row.data.total) : null;
  } else if (doc.kind === "sale") {
    const row = await db
      .from("sales")
      .select("total,customer_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? Number(row.data.total) : null;
  }

  const photoUrl = await signedPhotoUrl(db, doc.storage_path);
  const linesTotal = lines.reduce((sum, line) => sum + Number(line.sum), 0);
  const totalsMismatch =
    declaredTotal != null && Math.abs(linesTotal - declaredTotal) > TOLERANCE;
  const receiptFields = extraction?.payload?.extracted as
    | {
        bank?: string;
        operation_id?: string;
        datetime?: string;
        amount?: number;
        sender_name?: string;
        receiver_name?: string;
        purpose?: string;
        confidence?: number;
      }
    | undefined;

  return (
    <>
      <Link className="back-link" href="/documents">
        ← Документы
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {doc.kind === "purchase" ? "ПРИХОД" : doc.kind === "sale" ? "ПРОДАЖА" : "ОПЛАТА"}
          </span>
          <h1>Документ</h1>
        </div>
      </div>
      {params2.saved && (
        <p className="notice success" role="status">
          Строка сохранена.
        </p>
      )}
      {params2.confirmed && (
        <p className="notice success" role="status">
          Оцифровка подтверждена.
        </p>
      )}
      {params2.retried && (
        <p className="notice success" role="status">
          Запустили распознавание заново — обновите страницу через несколько секунд.
        </p>
      )}
      {params2.error && (
        <p className="form-error" role="alert">
          Не удалось выполнить действие. Проверьте значения и попробуйте снова.
        </p>
      )}
      <div className="documents-layout">
        <section className="panel">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt="Фото документа" className="document-photo" />
          ) : (
            <p className="muted">Фото недоступно.</p>
          )}
        </section>
        <section className="panel">
          <div className="section-title">
            <h2>Статус</h2>
            <span
              className={
                doc.status === "digitized"
                  ? "tag green"
                  : doc.status === "review" || doc.status === "failed"
                    ? "tag reversed-tag"
                    : "tag"
              }
            >
              {doc.status === "uploaded"
                ? "Ожидает"
                : doc.status === "processing"
                  ? "Распознаём…"
                  : doc.status === "digitized"
                    ? "Оцифрована"
                    : doc.status === "review"
                      ? "Расхождение"
                      : "Ошибка"}
            </span>
          </div>
          {doc.error_message && <p className="muted">{doc.error_message}</p>}
          {(doc.status === "failed" || doc.status === "uploaded") && doc.kind && (
            <form action={retryRecognition} className="simple-operation-actions">
              <input type="hidden" name="id" value={doc.id} />
              <input type="hidden" name="kind" value={doc.kind} />
              {declaredTotal != null && (
                <input type="hidden" name="declared_total" value={declaredTotal} />
              )}
              <button className="button" type="submit">
                {doc.status === "failed" ? "Повторить распознавание" : "Распознать сейчас"}
              </button>
            </form>
          )}
          {extraction && (
            <p className="muted">
              {extraction.provider} · {extraction.model_version}
              {extraction.latency_ms != null ? ` · ${extraction.latency_ms} мс` : ""}
            </p>
          )}
        </section>
      </div>

      {doc.kind === "payment" && receiptFields && (
        <section className="panel">
          <h2>Распознанные данные чека</h2>
          <dl className="details">
            <dt>Банк</dt>
            <dd>{receiptFields.bank ?? "—"}</dd>
            <dt>Номер операции</dt>
            <dd>{receiptFields.operation_id ?? "—"}</dd>
            <dt>Дата и время</dt>
            <dd>{receiptFields.datetime ?? "—"}</dd>
            <dt>Сумма</dt>
            <dd>{receiptFields.amount != null ? money(receiptFields.amount) : "—"}</dd>
            <dt>Отправитель</dt>
            <dd>{receiptFields.sender_name ?? "—"}</dd>
            <dt>Получатель</dt>
            <dd>{receiptFields.receiver_name ?? "—"}</dd>
          </dl>
        </section>
      )}

      {(doc.kind === "purchase" || doc.kind === "sale") && lines.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>Позиции</h2>
            {declaredTotal != null && (
              <span className={totalsMismatch ? "tag reversed-tag" : "tag green"}>
                Строки: {money(linesTotal)} · В накладной: {money(declaredTotal)}
              </span>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>№</th>
                  <th>Название</th>
                  <th>Кол-во</th>
                  <th>Ед.</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                  <th>
                    <span className="sr-only">Сохранить</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const lineMismatch =
                    Math.abs(Number(line.qty) * Number(line.price) - Number(line.sum)) > TOLERANCE;
                  const lowConfidence = line.confidence != null && line.confidence < 0.8;
                  return (
                    <tr
                      key={line.id}
                      className={lineMismatch ? "line-mismatch" : lowConfidence ? "warning" : ""}
                    >
                      <td colSpan={7} className="document-line-cell">
                        <form action={updateLine} className="document-line-form">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="document_id" value={doc.id} />
                          <span className="line-n">{line.n}</span>
                          <input name="name_raw" defaultValue={line.name_raw} maxLength={200} />
                          <input name="qty" defaultValue={line.qty} inputMode="decimal" />
                          <input name="unit" defaultValue={line.unit} />
                          <input name="price" defaultValue={line.price} inputMode="decimal" />
                          <span className="line-sum">{money(line.sum)}</span>
                          <button className="text-button" type="submit">
                            Сохранить
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {doc.status === "review" && (
            <form action={confirmDocument} className="simple-operation-actions">
              <input type="hidden" name="id" value={doc.id} />
              <button className="button primary" type="submit">
                Подтвердить оцифровку
              </button>
            </form>
          )}
        </section>
      )}
    </>
  );
}
