import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { EntryForm } from "@/components/entry-form";
import { money, quantity } from "@/lib/format";
import { creditLimitExceeded } from "@/lib/credit-limit";
import { createLink, revokeLink, setPromisedDate } from "@/app/(workspace)/[kind]/actions";
import { dayMonth, promiseStatus } from "@/lib/promise";
import { paymentLabel } from "@/lib/entry-labels";
import { bishkekDate } from "@/lib/day-summary";

type ShareLink = { id: string; token: string; revoked_at: string | null };
type Aging = {
  due_0_30: string;
  due_31_60: string;
  due_61_90: string;
  due_over_90: string;
  oldest_days: number;
};

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
    linked?: string;
    revoked?: string;
    reversed?: string;
    promised?: string;
    adjusted?: string;
  }>;
}) {
  const { kind, id } = await params;
  if (!isDirectory(kind)) notFound();
  const { db, organizationId } = await getContext();
  const { error, saved, linked, revoked, reversed, promised, adjusted } = await searchParams;
  let entry: Entry | undefined;
  if (id !== "new") {
    if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
    const result = await db
      .from(directoryMeta[kind].view)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw new Error("Не удалось открыть запись");
    if (!result.data) notFound();
    entry = result.data as Entry;
  }

  const isParty = kind === "customers" || kind === "suppliers";
  let activeLink: ShareLink | undefined;
  let origin = "";
  let aging: Aging | null = null;
  if (entry && kind === "customers") {
    const agingResult = await db
      .from("customer_debt_aging")
      .select("due_0_30,due_31_60,due_61_90,due_over_90,oldest_days")
      .eq("organization_id", organizationId)
      .eq("customer_id", entry.id)
      .maybeSingle();
    aging = (agingResult.data as Aging | null) ?? null;
    const links = await db
      .from("share_links")
      .select("id,token,revoked_at")
      .eq("organization_id", organizationId)
      .eq("customer_id", entry.id)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    activeLink = (links.data ?? [])[0] as ShareLink | undefined;
    const h = await headers();
    origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  }

  type HistoryRow = {
    kind: "sale" | "purchase" | "payment";
    id: string;
    label: string;
    amount: string;
    occurred_at: string;
    reversed: boolean;
    reversalComment: string | null;
    documentId: string | null;
    pending: boolean;
    opening: boolean;
    /** Комментарий скидки/возврата. */
    note?: string | null;
  };
  let history: HistoryRow[] = [];
  if (entry && isParty) {
    const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
    const invoiceTable = kind === "customers" ? "sales" : "purchases";
    const [invoices, pays] = await Promise.all([
      db
        .from(invoiceTable)
        .select("id,total,occurred_at,reversed_at,reversal_comment,document_id,is_opening")
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id)
        .eq("status", "posted")
        .order("occurred_at", { ascending: false })
        .limit(20),
      db
        .from("payments")
        .select("id,amount,occurred_at,reversed_at,reversal_comment,document_id,status,is_opening,kind,note")
        .eq("organization_id", organizationId)
        .eq(partyColumn, entry.id)
        .eq("direction", kind === "customers" ? "incoming" : "outgoing")
        .neq("status", "rejected")
        .order("occurred_at", { ascending: false })
        .limit(20),
    ]);
    history = [
      ...(invoices.data ?? []).map((r) => ({
        kind: (kind === "customers" ? "sale" : "purchase") as HistoryRow["kind"],
        id: r.id,
        label: r.is_opening ? "Долг из тетради" : kind === "customers" ? "Продажа" : "Приход",
        amount: r.total,
        occurred_at: r.occurred_at,
        reversed: Boolean(r.reversed_at),
        reversalComment: r.reversal_comment,
        documentId: r.document_id,
        pending: false,
        opening: Boolean(r.is_opening),
      })),
      ...(pays.data ?? []).map((p) => ({
        kind: "payment" as const,
        id: p.id,
        label: paymentLabel(p.kind, { opening: p.is_opening, pending: p.status === "pending" }),
        note: p.note,
        amount: p.amount,
        occurred_at: p.occurred_at,
        reversed: Boolean(p.reversed_at),
        reversalComment: p.reversal_comment,
        documentId: p.document_id,
        pending: p.status === "pending",
        opening: Boolean(p.is_opening),
      })),
    ]
      .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
      .slice(0, 20);
  }

  const overLimit =
    entry && kind === "customers"
      ? creditLimitExceeded(entry.balance ?? 0, entry.credit_limit, 0, false)
      : null;

  const newOperationHref = (type: string) =>
    `/money/new?type=${["sale", "purchase", "payment"].includes(type) ? type : "payment"}&party=${entry?.id ?? ""}`;

  const today = bishkekDate();
  const promise =
    entry && kind === "customers"
      ? promiseStatus(entry.promised_date, Number(entry.balance ?? 0), today)
      : ({ kind: "none" } as const);
  const promiseLine =
    promise.kind === "broken"
      ? ` Вы обещали оплатить до ${dayMonth(promise.date)}.`
      : promise.kind === "upcoming"
        ? ` Срок оплаты — ${dayMonth(promise.date)}.`
        : "";
  const reminderText =
    entry && kind === "customers" && activeLink
      ? `Здравствуйте! Ваш долг в ${money(entry.balance ?? 0)}.${promiseLine} Посмотреть и оплатить: ${origin}/c/${activeLink.token}`
      : entry && kind === "customers"
        ? `Здравствуйте! Ваш долг: ${money(entry.balance ?? 0)}.${promiseLine}`
        : "";
  const waHref =
    entry?.phone && reminderText
      ? `https://wa.me/${entry.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(reminderText)}`
      : undefined;

  return (
    <>
      <Link className="back-link" href={`/${kind}`}>
        ← {directoryMeta[kind].title}
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            {entry?.name ??
              `Добавить: ${directoryMeta[kind].single.toLowerCase()}`}
          </h1>
          <p className="muted">
            {entry
              ? kind === "products"
                ? `Остаток: ${quantity(entry.stock ?? 0)} ${entry.unit}`
                : `Долг / аванс: ${money(entry.balance ?? 0)}`
              : "Заполните основные данные."}
            {entry?.credit_limit != null && ` · лимит ${money(entry.credit_limit)}`}
            {overLimit && <span className="tag reversed-tag">больше лимита</span>}
          </p>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Изменения сохранены.
        </p>
      )}
      {linked && (
        <p className="notice success" role="status">
          Ссылка для клиента готова — можно отправить в WhatsApp.
        </p>
      )}
      {revoked && (
        <p className="notice success" role="status">
          Ссылка отозвана, старая ссылка больше не откроется.
        </p>
      )}
      {entry && isParty && reversed && (
        <div className="notice success" role="status">
          <p>Запись отменена. Долг пересчитан, история сохранена.</p>
          <Link className="button" href={newOperationHref(reversed)}>
            Записать правильно
          </Link>
        </div>
      )}
      {entry && isParty && error === "reversal" && (
        <p className="form-error" role="alert">
          Не удалось отменить запись. Возможно, она уже отменена.
        </p>
      )}
      {adjusted && (
        <p className="notice success" role="status">
          {adjusted === "return" ? "Возврат товара записан" : "Скидка записана"} — долг уменьшен.
        </p>
      )}
      {promised && (
        <p className="notice success" role="status">
          {promised === "1" ? "Обещанная дата сохранена." : "Обещанная дата убрана."}
        </p>
      )}
      {error === "promise" && (
        <p className="form-error" role="alert">
          Дата должна быть не раньше сегодняшней и не дальше чем через год.
        </p>
      )}
      {error === "link" && (
        <p className="form-error" role="alert">
          Не удалось выполнить действие со ссылкой.
        </p>
      )}
      {entry && isParty && (
        <section className="panel party-actions">
          {waHref && (
            <a className="button primary" href={waHref} target="_blank" rel="noreferrer">
              Напомнить в WhatsApp
            </a>
          )}
          <Link className="button" href={`/${kind}/${entry.id}/statement`}>
            Акт сверки
          </Link>
          <Link className="button" href={newOperationHref(kind === "customers" ? "sale" : "purchase")}>
            {kind === "customers" ? "Продажа" : "Приход"}
          </Link>
          <Link className="button" href={newOperationHref("payment")}>
            Оплата
          </Link>
          <Link className="button" href={`/money/adjustment?party=${entry.id}`}>
            Скидка / возврат
          </Link>
        </section>
      )}
      {entry && kind === "customers" && (
        <section className="panel debt-terms">
          <h2>Срок и давность долга</h2>
          {promise.kind === "broken" ? (
            <p className="form-error">
              Обещал оплатить до {dayMonth(promise.date)} — прошло {promise.daysLate} дн.
            </p>
          ) : promise.kind === "upcoming" ? (
            <p>
              Обещал оплатить до <strong>{dayMonth(promise.date)}</strong>
              {promise.daysLeft === 0 ? " — сегодня" : ` — через ${promise.daysLeft} дн.`}
            </p>
          ) : (
            <p className="muted">Обещанной даты нет.</p>
          )}
          <form action={setPromisedDate} className="promise-form">
            <input type="hidden" name="customer_id" value={entry.id} />
            <label>
              Обещал оплатить до
              <input
                type="date"
                name="promised_date"
                min={today}
                defaultValue={entry.promised_date ?? ""}
              />
            </label>
            <button className="button" type="submit">
              Сохранить
            </button>
          </form>
          {aging ? (
            <dl className="aging">
              <div>
                <dt>до 30 дней</dt>
                <dd>{money(aging.due_0_30)}</dd>
              </div>
              <div className={Number(aging.due_31_60) > 0 ? "aging-late" : ""}>
                <dt>31–60 дней</dt>
                <dd>{money(aging.due_31_60)}</dd>
              </div>
              <div className={Number(aging.due_61_90) > 0 ? "aging-late" : ""}>
                <dt>61–90 дней</dt>
                <dd>{money(aging.due_61_90)}</dd>
              </div>
              <div className={Number(aging.due_over_90) > 0 ? "aging-late" : ""}>
                <dt>больше 90 дней</dt>
                <dd>{money(aging.due_over_90)}</dd>
              </div>
            </dl>
          ) : (
            <p className="muted">Долга нет — давность не считается.</p>
          )}
        </section>
      )}
      {entry && kind === "customers" && (
        <section className="panel share-link-panel">
          <h2>Страница клиента без входа</h2>
          {activeLink ? (
            <>
              <p className="muted">
                {origin}/c/{activeLink.token}
              </p>
              <form action={revokeLink} className="simple-operation-actions">
                <input type="hidden" name="customer_id" value={entry.id} />
                <input type="hidden" name="link_id" value={activeLink.id} />
                <button className="button" type="submit">
                  Отозвать ссылку
                </button>
              </form>
            </>
          ) : (
            <form action={createLink} className="simple-operation-actions">
              <input type="hidden" name="customer_id" value={entry.id} />
              <button className="button primary" type="submit">
                Создать ссылку для клиента
              </button>
            </form>
          )}
        </section>
      )}
      {entry && isParty && (
        <section className="panel">
          <h2>История</h2>
          {history.length ? (
            <ul className="history-list">
              {history.map((row) => (
                <li key={row.kind + row.id} className={row.reversed ? "history-item reversed-row" : "history-item"}>
                  <div className="history-main">
                    <span className="history-kind">
                      {row.label}
                      {row.reversed && <span className="tag reversed-tag">отменена</span>}
                    </span>
                    <strong className="history-amount">{money(row.amount)}</strong>
                  </div>
                  <div className="history-meta">
                    <span className="muted">
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bishkek",
                      }).format(new Date(row.occurred_at))}
                    </span>
                    <span className="history-actions">
                      {row.kind === "sale" && !row.reversed && !row.opening && (
                        <Link className="text-button" href={`/money/send/${row.id}`}>
                          Отправить
                        </Link>
                      )}
                      {row.documentId && (
                        <Link className="text-button" href={`/documents/${row.documentId}`}>
                          Фото
                        </Link>
                      )}
                      {row.pending ? (
                        <Link className="text-button" href="/claims">
                          Рассмотреть
                        </Link>
                      ) : (
                        !row.reversed && (
                          <Link
                            className="text-button"
                            href={`/money/reverse/${row.kind}/${row.id}?back=${encodeURIComponent(`/${kind}/${entry.id}`)}`}
                          >
                            Отменить
                          </Link>
                        )
                      )}
                    </span>
                  </div>
                  {row.note && <p className="history-comment muted">{row.note}</p>}
                  {row.reversed && row.reversalComment && (
                    <p className="history-comment muted">Причина отмены: {row.reversalComment}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Операций пока нет.</p>
          )}
        </section>
      )}
      <section className="panel form-panel">
        <EntryForm
          kind={kind}
          entry={entry}
          error={error === "link" || error === "reversal" ? undefined : error}
        />
      </section>
    </>
  );
}
