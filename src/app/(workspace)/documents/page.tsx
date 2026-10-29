import Link from "next/link";
import { getContext } from "@/lib/context";
import { Icon } from "@/components/icon";
import { expenseCategoryLabel } from "@/lib/expenses";
import { DeleteWithUndo } from "@/components/delete-with-undo";
import { recognitionStuck } from "@/lib/document-status";

type DocRow = {
  id: string;
  kind: "purchase" | "sale" | "payment" | "expense" | null;
  status: string;
  error_message: string | null;
  created_at: string;
  mime_type: string | null;
};

/**
 * Фото показываем по 10 (просьба пользователя 29.10.2026 — беречь трафик):
 * миниатюры грузятся только у показанных, дальше — «Показать ещё 10».
 * Для вкладок и поиска просматриваем последние 200 и отбираем.
 */
const PAGE = 10;
const SCANNED = 200;

const statusLabel: Record<string, { label: string; className: string }> = {
  uploaded: { label: "Читаем фото", className: "tag" },
  processing: { label: "Распознаём…", className: "tag" },
  digitized: { label: "Готова", className: "tag green" },
  review: { label: "Проверьте сумму", className: "tag reversed-tag" },
  failed: { label: "Ошибка", className: "tag reversed-tag" },
};

/** Название строки (макет 29.10.2026): «Фото продажи», «Чек расхода». */
const kindTitle: Record<string, string> = {
  purchase: "Фото накладной",
  sale: "Фото продажи",
  payment: "Чек оплаты",
  expense: "Чек расхода",
};
/** Кого нет у фото без записи. */
const nobody: Record<string, string> = {
  purchase: "Поставщик не указан",
  sale: "Клиент не указан",
  payment: "Клиент не указан",
  expense: "Расход магазина",
};
/** Кнопка у фото без записи — открыть форму для проверки и подтверждения. */
const recordLabel: Record<string, string> = {
  purchase: "Оформить приход",
  sale: "Оформить продажу",
  payment: "Оформить оплату",
  expense: "Оформить расход",
};

// «29 октября, 08:17».
const uploaded = (iso: string) => {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Bishkek" }).format(d);
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bishkek" }).format(d);
  return `${day}, ${time}`;
};

const roleLabel = { customer: "клиент", supplier: "поставщик", expense: "расход магазина" } as const;

const TABS = [
  ["all", "Все"],
  ["orphan", "Без записи"],
  ["linked", "С записью"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Фото без записи: ни продажи, ни прихода, ни оплаты, ни расхода (и не в работе). */
const isOrphan = (doc: DocRow, links: Links) => !links.linked.has(doc.id) && doc.status !== "processing";

/** Статус для списка: отменённая запись и фото без записи — словами (задачи 14, 31). */
function statusOf(doc: DocRow, links: Links) {
  if (links.reversed.has(doc.id)) return { label: "Отменена", className: "tag" };
  if (isOrphan(doc, links)) return { label: "Без записи", className: "tag doc-tag-orphan" };
  if (recognitionStuck(doc)) return { label: "Не прочиталось", className: "tag reversed-tag" };
  return statusLabel[doc.status] ?? statusLabel.uploaded;
}

const recordHref = (doc: DocRow) =>
  doc.kind === "expense" ? "/money/expense" : `/money/new?type=${doc.kind ?? "sale"}&documentId=${doc.id}`;

export default async function Documents({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string; tab?: string; q?: string; n?: string }>;
}) {
  const params = await searchParams;
  const tab: Tab = params.tab === "orphan" || params.tab === "linked" ? params.tab : "all";
  const q = (params.q ?? "").trim().slice(0, 100);
  // Сколько показать: 10, 20, 30… (?n=), не больше просматриваемых.
  const shown = Math.min(SCANNED, Math.max(PAGE, Math.ceil((parseInt(params.n ?? "") || PAGE) / PAGE) * PAGE));
  const { db, organizationId } = await getContext();
  const { data, error } = await db
    .from("documents")
    .select("id,kind,status,error_message,created_at,mime_type")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    // Без вкладки и поиска — на одно больше: так видно, есть ли ещё.
    .limit(tab === "all" && !q ? shown + 1 : SCANNED);
  if (error) throw new Error("Не удалось загрузить документы");
  const all = (data ?? []) as DocRow[];
  const ids = all.map((d) => d.id);
  const [links, duplicates] = await Promise.all([
    partiesOf(db, organizationId, ids),
    duplicateDocuments(db, organizationId, ids),
  ]);
  const parties = links.parties;

  // Вкладка и поиск — по названию, клиенту или поставщику, статусу.
  const needle = q.toLocaleLowerCase("ru");
  const found = all
    .filter((doc) => (tab === "orphan" ? isOrphan(doc, links) : tab === "linked" ? links.linked.has(doc.id) : true))
    .filter((doc) => {
      if (!needle) return true;
      const party = parties.get(doc.id);
      const text = [
        doc.kind ? kindTitle[doc.kind] : "Фото",
        party?.name ?? (doc.kind ? nobody[doc.kind] : ""),
        statusOf(doc, links).label,
        uploaded(doc.created_at),
      ].join(" ");
      return text.toLocaleLowerCase("ru").includes(needle);
    });
  const documents = found.slice(0, shown);
  const hasMore = found.length > shown;
  const anyOrphan = documents.some((doc) => isOrphan(doc, links));
  const href = (t: Tab, n?: number) => {
    const query = new URLSearchParams();
    if (t !== "all") query.set("tab", t);
    if (q) query.set("q", q);
    if (n) query.set("n", String(n));
    const text = query.toString();
    return `/documents${text ? `?${text}` : ""}`;
  };

  return (
    <>
      {params.deleted && (
        <p className="notice success" role="status">
          Фото удалено.
        </p>
      )}
      <div className="page-heading doc-heading">
        <div>
          <h1>Документы</h1>
          <p className="doc-subtitle">
            <span className="doc-long">Накладные и чеки к операциям</span>
            <span className="doc-short">Накладные и чеки</span>
          </p>
          <p className="muted">
            <span className="doc-long">Фото само по себе не меняет долг. Учитывается подтверждённая операция.</span>
            <span className="doc-short">Фото само по себе не меняет долг. Операция учитывается после подтверждения.</span>
          </p>
        </div>
      </div>

      <nav className="doc-tabs" aria-label="Документы">
        {TABS.map(([t, label]) => (
          <Link key={t} href={href(t)} className={t === tab ? "active" : undefined} aria-current={t === tab ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <form className="doc-search" action="/documents" role="search">
        {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
        </svg>
        <input name="q" type="search" defaultValue={q} placeholder="Найти документ" aria-label="Найти документ" autoComplete="off" />
      </form>

      {documents.length ? (
        <section className="panel doc-panel">
          {/* Одна разметка: на компьютере — таблицей с шапкой, на телефоне — карточками. */}
          <div className="doc-row doc-row-head" aria-hidden="true">
            <span>Документ</span>
            <span>Статус</span>
            <span>Загружен</span>
          </div>
          <ul className="doc-rows">
            {documents.map((doc) => {
              const status = statusOf(doc, links);
              const party = parties.get(doc.id);
              const orphan = isOrphan(doc, links);
              const open = `/documents/${doc.id}?from=documents`;
              const pdf = doc.mime_type === "application/pdf";
              return (
                <li key={doc.id} id={`doc-${doc.id}`} className="doc-row">
                  <Link href={open} className="doc-thumb" aria-hidden="true" tabIndex={-1}>
                    {pdf ? (
                      <span className="page-thumb-pdf">PDF</span>
                    ) : (
                      // Маленькая копия по постоянному адресу — браузер не качает её повторно.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/documents/${doc.id}/thumb`} alt="" loading="lazy" decoding="async" />
                    )}
                  </Link>
                  <span className="doc-main">
                    <Link href={open} className="doc-title">
                      {doc.kind ? kindTitle[doc.kind] : "Фото"}
                    </Link>
                    <span className="doc-party muted">
                      {party ? (
                        <>
                          {party.name} <small>· {roleLabel[party.role]}</small>
                        </>
                      ) : doc.kind ? (
                        nobody[doc.kind]
                      ) : (
                        "Не записано"
                      )}
                    </span>
                  </span>
                  <span className="doc-status">
                    <span className={status.className}>{status.label}</span>
                    {duplicates.has(doc.id) && <span className="tag duplicate-tag">дубликат</span>}
                  </span>
                  <span className="doc-date">{uploaded(doc.created_at)}</span>
                  <span className="doc-action">
                    {orphan ? (
                      <Link className="button doc-action-button" href={recordHref(doc)}>
                        {recordLabel[doc.kind ?? "sale"]}
                      </Link>
                    ) : (
                      <Link className="button doc-action-button" href={open}>
                        Открыть
                      </Link>
                    )}
                  </span>
                  <details className="more-menu record-menu doc-menu">
                    <summary className="record-menu-toggle" aria-label="Действия с фото">
                      <Icon name="more" />
                    </summary>
                    <div className="more-menu-list">
                      <Link href={open}>Открыть фото</Link>
                      {orphan && (
                        <DeleteWithUndo
                          what="document"
                          id={doc.id}
                          title="Удалить фото?"
                          label="Удалить"
                          className="doc-menu-delete"
                          hide={`doc-${doc.id}`}
                        />
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          {hasMore && (
            // Следующие 10 — по нажатию; страница остаётся на месте, новые фото — ниже.
            <Link className="button doc-more" href={href(tab, shown + PAGE)} scroll={false}>
              Показать ещё {PAGE}
            </Link>
          )}
        </section>
      ) : all.length ? (
        <p className="muted doc-none">{q ? "По этому поиску ничего не нашлось." : "Здесь пока пусто."}</p>
      ) : (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="camera" />
          </span>
          <h2>Документов пока нет</h2>
          <p>
            Фото появятся здесь после первой продажи или товара от поставщика с
            приложенным фото.
          </p>
        </div>
      )}
      {anyOrphan && (
        <p className="day-note doc-hint">
          <span className="report-hint-icon" aria-hidden="true">
            i
          </span>
          «Оформить» - открыть форму для проверки и подтверждения.
        </p>
      )}
    </>
  );
}

type Db = Awaited<ReturnType<typeof getContext>>["db"];

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
type Links = { parties: Map<string, Party>; linked: Set<string>; reversed: Set<string> };

/**
 * Клиент или поставщик записи, к которой приложен документ, — одним запросом
 * на таблицу; заодно — есть ли запись вообще и не отменена ли она.
 */
async function partiesOf(
  db: Awaited<ReturnType<typeof getContext>>["db"],
  organizationId: string,
  documentIds: string[],
): Promise<Links> {
  const result = new Map<string, Party>();
  const linked = new Set<string>();
  const reversed = new Set<string>();
  if (!documentIds.length) return { parties: result, linked, reversed };
  const [purchases, sales, payments, expenses] = await Promise.all([
    db.from("purchases").select("document_id,supplier_id,reversed_at").eq("organization_id", organizationId).in("document_id", documentIds),
    db.from("sales").select("document_id,customer_id,reversed_at").eq("organization_id", organizationId).in("document_id", documentIds),
    db
      .from("payments")
      .select("document_id,customer_id,supplier_id,reversed_at")
      .eq("organization_id", organizationId)
      .in("document_id", documentIds),
    db.from("expenses").select("document_id,category,reversed_at").eq("organization_id", organizationId).in("document_id", documentIds),
  ]);
  for (const r of [...(purchases.data ?? []), ...(sales.data ?? []), ...(payments.data ?? []), ...(expenses.data ?? [])] as {
    document_id: string | null;
    reversed_at: string | null;
  }[]) {
    if (!r.document_id) continue;
    linked.add(r.document_id);
    if (r.reversed_at) reversed.add(r.document_id);
  }
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
  return { parties: result, linked, reversed };
}
