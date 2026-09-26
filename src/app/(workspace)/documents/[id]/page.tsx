import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { money } from "@/lib/format";
import { documentPages, signedPhotoUrl } from "@/lib/storage";
import { DocumentPhotos } from "@/components/document-photos";
import { retryRecognition, confirmDocument, updateLine, saveAlias } from "../actions";
import { similarity } from "@/lib/match";

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
  searchParams: Promise<{
    saved?: string;
    confirmed?: string;
    retried?: string;
    aliasSaved?: string;
    error?: string;
  }>;
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
      .limit(10),
  ]);
  const lines = (linesResult.data ?? []) as Line[];
  // Последняя строка — итог оцифровки; задержка вызова Gemini записана в
  // строке кеша (cache_extraction), поэтому берём её из последней, где она есть.
  const extractions = (extractionResult.data ?? []) as Extraction[];
  const extraction: Extraction | null = extractions[0]
    ? {
        ...extractions[0],
        latency_ms:
          extractions.find((e) => e.latency_ms != null)?.latency_ms ?? null,
      }
    : null;

  let declaredTotal: number | null = null;
  let party: { id: string; name: string; aliases: string[]; kind: "customer" | "supplier" } | null = null;
  if (doc.kind === "purchase") {
    const row = await db
      .from("purchases")
      .select("total,supplier_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? Number(row.data.total) : null;
    if (row.data) {
      const supplier = await db
        .from("suppliers")
        .select("id,name,aliases")
        .eq("organization_id", organizationId)
        .eq("id", row.data.supplier_id)
        .maybeSingle();
      if (supplier.data)
        party = { id: supplier.data.id, name: supplier.data.name, aliases: supplier.data.aliases ?? [], kind: "supplier" };
    }
  } else if (doc.kind === "sale") {
    const row = await db
      .from("sales")
      .select("total,customer_id")
      .eq("organization_id", organizationId)
      .eq("document_id", id)
      .maybeSingle();
    declaredTotal = row.data ? Number(row.data.total) : null;
    if (row.data) {
      const customer = await db
        .from("customers")
        .select("id,name,aliases")
        .eq("organization_id", organizationId)
        .eq("id", row.data.customer_id)
        .maybeSingle();
      if (customer.data)
        party = { id: customer.data.id, name: customer.data.name, aliases: customer.data.aliases ?? [], kind: "customer" };
    }
  }

  const pages = await documentPages(db, organizationId, doc.id);
  const photoUrls = await Promise.all(pages.map((page) => signedPhotoUrl(db, page.storage_path)));
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
  const invoiceFields = extraction?.payload?.extracted as
    | { counterparty?: { name_raw?: string }; document_type?: "invoice_in" | "invoice_out" }
    | undefined;
  const recognizedCounterparty = invoiceFields?.counterparty?.name_raw?.trim();
  const counterpartyMismatch =
    party && recognizedCounterparty
      ? Math.max(
          similarity(recognizedCounterparty, party.name),
          ...party.aliases.map((alias) => similarity(recognizedCounterparty, alias)),
          0,
        ) < 0.5
      : false;

  const documentTypeLabel: Record<"invoice_in" | "invoice_out", string> = {
    invoice_in: "Накладная от поставщика (приход)",
    invoice_out: "Накладная клиенту (продажа)",
  };
  const expectedDocumentType = doc.kind === "purchase" ? "invoice_in" : doc.kind === "sale" ? "invoice_out" : null;
  const recognizedDocumentType = invoiceFields?.document_type;
  const documentTypeMismatch =
    !!recognizedDocumentType && !!expectedDocumentType && recognizedDocumentType !== expectedDocumentType;

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
        {(doc.kind === "purchase" || doc.kind === "sale") && (
          <a className="button" href={`/documents/${doc.id}/pdf`}>
            Скачать PDF
          </a>
        )}
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
      {params2.aliasSaved && (
        <p className="notice success" role="status">
          Синоним сохранён — в следующий раз это имя узнается сразу.
        </p>
      )}
      {params2.error && (
        <p className="form-error" role="alert">
          Не удалось выполнить действие. Проверьте значения и попробуйте снова.
        </p>
      )}
      {/* Сначала — всё, что требует внимания; ниже фото и позиции рядом. */}
      <section className="panel doc-status">
        <div className="doc-status-row">
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
          {extraction && (
            <span className="muted doc-status-model">
              {extraction.provider} · {extraction.model_version}
              {extraction.latency_ms != null ? ` · ${extraction.latency_ms} мс` : ""}
            </span>
          )}
          {(doc.status === "failed" || doc.status === "uploaded") && doc.kind && (
            <form action={retryRecognition} className="doc-status-retry">
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
        </div>
        {doc.error_message && <p className="muted">{doc.error_message}</p>}
        {recognizedDocumentType && documentTypeMismatch && (
          <p className="photo-check-mismatch">
            ADRE увидел: {documentTypeLabel[recognizedDocumentType]} — не похоже на «
            {expectedDocumentType && documentTypeLabel[expectedDocumentType]}», проверьте фото
          </p>
        )}
      </section>

      {counterpartyMismatch && party && recognizedCounterparty && (
        <section className="panel counterparty-mismatch">
          <p>
            На фото написано «{recognizedCounterparty}», а выбран(а) «{party.name}». Долг это не
            меняет — только пометка.
          </p>
          <form action={saveAlias} className="simple-operation-actions">
            <input type="hidden" name="kind" value={party.kind} />
            <input type="hidden" name="party_id" value={party.id} />
            <input type="hidden" name="alias" value={recognizedCounterparty} />
            <input type="hidden" name="document_id" value={doc.id} />
            <button className="button" type="submit">
              Это точно «{party.name}», запомнить как синоним
            </button>
          </form>
        </section>
      )}

      <div className="documents-layout">
        <section className="panel doc-photo-panel">
          <DocumentPhotos urls={photoUrls.length ? photoUrls : [null]} />
        </section>

        {doc.kind === "payment" ? (
          <section className="panel">
            <h2>Распознанные данные чека</h2>
            {receiptFields ? (
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
            ) : (
              <p className="muted">Данные появятся после распознавания.</p>
            )}
          </section>
        ) : (
          // Высоту ряда задаёт фото; позиции подстраиваются под неё и
          // прокручиваются, если не помещаются.
          <section className="panel doc-lines-panel">
            <div className="doc-lines-inner">
              <div className="section-title">
                <h2>Позиции</h2>
                {declaredTotal != null && lines.length > 0 && (
                  <span className={totalsMismatch ? "tag reversed-tag" : "tag green"}>
                    Строки: {money(linesTotal)} · В записи: {money(declaredTotal)}
                  </span>
                )}
              </div>
              {lines.length > 0 ? (
                <>
                  <div className="doc-lines-scroll">
              <ol className="invoice-lines">
                {lines.map((line) => {
                  const computed = Number(line.qty) * Number(line.price);
                  const lineMismatch = Math.abs(computed - Number(line.sum)) > TOLERANCE;
                  const lowConfidence = line.confidence != null && line.confidence < 0.8;
                  return (
                    <li
                      key={line.id}
                      className={`invoice-line${lineMismatch ? " line-mismatch" : lowConfidence ? " line-doubt" : ""}`}
                    >
                      <details>
                        <summary>
                          <span className="invoice-line-n">{line.n}</span>
                          <span className="invoice-line-body">
                            <span className="invoice-line-name">{line.name_raw}</span>
                            <span className="invoice-line-calc">
                              <span className="nowrap">
                                {line.qty} {line.unit} × {money(line.price)}
                              </span>
                              {lineMismatch && (
                                <>
                                  {" "}· по бумаге <span className="nowrap">{money(line.sum)}</span>, должно
                                  быть <span className="nowrap">{money(computed)}</span>
                                </>
                              )}
                              {!lineMismatch && lowConfidence && <> · проверьте, плохо читается</>}
                            </span>
                          </span>
                          <span className="invoice-line-sum">{money(line.sum)}</span>
                        </summary>
                        <form action={updateLine} className="invoice-line-form">
                          <input type="hidden" name="line_id" value={line.id} />
                          <input type="hidden" name="document_id" value={doc.id} />
                          <label className="invoice-line-field-name">
                            Название
                            <input name="name_raw" defaultValue={line.name_raw} maxLength={200} />
                          </label>
                          <label>
                            Кол-во
                            <input name="qty" defaultValue={line.qty} inputMode="decimal" />
                          </label>
                          <label>
                            Ед.
                            <input name="unit" defaultValue={line.unit} />
                          </label>
                          <label>
                            Цена
                            <input name="price" defaultValue={line.price} inputMode="decimal" />
                          </label>
                          <button className="button primary" type="submit">
                            Сохранить
                          </button>
                        </form>
                      </details>
                    </li>
                  );
                })}
              </ol>
                  </div>
                  <p className="muted invoice-lines-hint">Нажмите на строку, чтобы исправить.</p>
                  {doc.status === "review" && (
                    <form action={confirmDocument} className="simple-operation-actions">
                      <input type="hidden" name="id" value={doc.id} />
                      <button className="button primary" type="submit">
                        Подтвердить оцифровку
                      </button>
                    </form>
                  )}
                </>
              ) : (
                <p className="muted">Позиции появятся после распознавания.</p>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
