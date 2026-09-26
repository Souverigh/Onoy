import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { EntryForm } from "@/components/entry-form";
import { money, quantity } from "@/lib/format";
import { createLink, revokeLink } from "@/app/(workspace)/[kind]/actions";

type ShareLink = { id: string; token: string; revoked_at: string | null };

export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; linked?: string; revoked?: string }>;
}) {
  const { kind, id } = await params;
  if (!isDirectory(kind)) notFound();
  const { db, organizationId } = await getContext();
  const { error, saved, linked, revoked } = await searchParams;
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
  if (entry && kind === "customers") {
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

  let history: { kind: string; amount: string; occurred_at: string; reversed: boolean }[] = [];
  if (entry && isParty) {
    const partyColumn = kind === "customers" ? "customer_id" : "supplier_id";
    if (kind === "customers") {
      const [sales, pays] = await Promise.all([
        db
          .from("sales")
          .select("total,occurred_at,reversed_at")
          .eq("organization_id", organizationId)
          .eq(partyColumn, entry.id)
          .eq("status", "posted")
          .order("occurred_at", { ascending: false })
          .limit(10),
        db
          .from("payments")
          .select("amount,occurred_at,reversed_at,status")
          .eq("organization_id", organizationId)
          .eq(partyColumn, entry.id)
          .eq("direction", "incoming")
          .neq("status", "rejected")
          .order("occurred_at", { ascending: false })
          .limit(10),
      ]);
      history = [
        ...(sales.data ?? []).map((s) => ({
          kind: "Продажа",
          amount: s.total,
          occurred_at: s.occurred_at,
          reversed: Boolean(s.reversed_at),
        })),
        ...(pays.data ?? []).map((p) => ({
          kind: p.status === "pending" ? "Заявка (ждёт)" : "Оплата",
          amount: p.amount,
          occurred_at: p.occurred_at,
          reversed: Boolean(p.reversed_at),
        })),
      ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    } else {
      const [purchases, pays] = await Promise.all([
        db
          .from("purchases")
          .select("total,occurred_at,reversed_at")
          .eq("organization_id", organizationId)
          .eq(partyColumn, entry.id)
          .eq("status", "posted")
          .order("occurred_at", { ascending: false })
          .limit(10),
        db
          .from("payments")
          .select("amount,occurred_at,reversed_at")
          .eq("organization_id", organizationId)
          .eq(partyColumn, entry.id)
          .eq("direction", "outgoing")
          .order("occurred_at", { ascending: false })
          .limit(10),
      ]);
      history = [
        ...(purchases.data ?? []).map((p) => ({
          kind: "Приход",
          amount: p.total,
          occurred_at: p.occurred_at,
          reversed: Boolean(p.reversed_at),
        })),
        ...(pays.data ?? []).map((p) => ({
          kind: "Оплата",
          amount: p.amount,
          occurred_at: p.occurred_at,
          reversed: Boolean(p.reversed_at),
        })),
      ].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    }
  }

  const reminderText =
    entry && kind === "customers" && activeLink
      ? `Здравствуйте! Ваш долг в ${money(entry.balance ?? 0)}. Посмотреть и оплатить: ${origin}/c/${activeLink.token}`
      : entry && kind === "customers"
        ? `Здравствуйте! Ваш долг: ${money(entry.balance ?? 0)}.`
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
          <Link className="button" href={`/money/new?type=payment`}>
            Оплата
          </Link>
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
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Операция</th>
                    <th>Сумма</th>
                    <th>Дата</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row, i) => (
                    <tr key={i} className={row.reversed ? "reversed-row" : ""}>
                      <td>
                        {row.kind}
                        {row.reversed && <span className="tag reversed-tag">сторно</span>}
                      </td>
                      <td>{money(row.amount)}</td>
                      <td>
                        {new Intl.DateTimeFormat("ru-RU", {
                          dateStyle: "medium",
                          timeStyle: "short",
                          timeZone: "Asia/Bishkek",
                        }).format(new Date(row.occurred_at))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">Операций пока нет.</p>
          )}
        </section>
      )}
      <section className="panel form-panel">
        <EntryForm kind={kind} entry={entry} error={error === "link" ? undefined : error} />
      </section>
    </>
  );
}
