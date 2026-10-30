import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { loadFeedback, loadPeople } from "@/lib/admin-data";
import { feedbackDue } from "@/lib/admin-feedback";
import { STAGES, actionLabel, agoText, isStageKey, stageOf, waText, whenText, whoLabel, type PersonRow, type StageKey } from "@/lib/admin-people";
import { subscriptionState } from "@/lib/subscription";
import { bishkekDate } from "@/lib/day-summary";
import { PRESETS, isBusinessType } from "@/lib/business";
import { waPhone } from "@/lib/share";

const PAGE = 25;
const SORTS = { action: "По последнему действию", new: "Сначала новые", paid: "По дате оплаты" } as const;
type Sort = keyof typeof SORTS;

const day = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

function payText(p: PersonRow, today: string) {
  if (p.kind === "account") return "-";
  if (!p.paid_until) return "без срока";
  const date = day(`${p.paid_until}T12:00:00Z`);
  if (p.paid_until < today) return `было до ${date}`;
  return p.trial ? `пробный до ${date}` : `до ${date}`;
}

/** Люди и магазины: счётчики-фильтры, поиск, таблица по 25 (на телефоне — карточки). */
export default async function AdminPeople({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string; sort?: string; type?: string; page?: string }>;
}) {
  const { db } = await requirePlatformAdmin();
  const params = await searchParams;
  const today = bishkekDate();
  const now = new Date();
  const people = (await loadPeople(db)).map((p) => {
    const sub = p.kind === "shop" ? subscriptionState(p.paid_until, null, Boolean(p.blocked_at), today) : null;
    return { ...p, stage: stageOf(p, sub) };
  });

  const dueRequests = (await loadFeedback(db)).filter((f) => feedbackDue(f, today)).length;

  const filter: StageKey | "contact" | null = params.f === "contact" ? "contact" : isStageKey(params.f) ? params.f : null;
  const sort: Sort = params.sort === "new" || params.sort === "paid" ? params.sort : "action";
  const type = isBusinessType(params.type) ? params.type : null;
  const q = (params.q ?? "").trim().toLowerCase().slice(0, 100);
  const qDigits = q.replace(/\D/g, "");

  const counts = new Map<StageKey, number>();
  for (const p of people) counts.set(p.stage.key, (counts.get(p.stage.key) ?? 0) + 1);

  const due = (p: PersonRow) => Boolean(p.next_contact && p.next_contact <= today);
  const rows = people
    .filter((p) => (filter === "contact" ? due(p) : !filter || p.stage.key === filter))
    .filter((p) => !type || (p.business_type ?? "shop") === type)
    .filter(
      (p) =>
        !q ||
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.email ?? "").toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (p.phone ?? "").replace(/\D/g, "").includes(qDigits)),
    )
    .sort((a, b) => {
      if (sort === "new")
        return (b.shop_created_at ?? b.user_created_at ?? "").localeCompare(a.shop_created_at ?? a.user_created_at ?? "");
      if (sort === "paid") return (a.paid_until ?? "9999").localeCompare(b.paid_until ?? "9999");
      return (b.last_action_at ?? "").localeCompare(a.last_action_at ?? "");
    });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const page = Math.min(pages, Math.max(1, Number(params.page) || 1));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  const href = (change: Record<string, string | number | null>) => {
    const next = new URLSearchParams();
    const merged = { f: filter, q: params.q ?? null, sort: sort === "action" ? null : sort, type, page: null, ...change };
    for (const [k, v] of Object.entries(merged)) if (v !== null && v !== "" && v !== undefined) next.set(k, String(v));
    const s = next.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  const view = shown.map((p) => {
    const link = p.kind === "shop" ? `/admin/shop/${p.org_id}` : `/admin/account/${p.user_id}`;
    const title = p.kind === "shop" ? p.name : p.email;
    const business = PRESETS[isBusinessType(p.business_type) ? p.business_type : "shop"].label;
    const sub =
      p.kind === "shop"
        ? `${business}${p.email ? ` · ${p.email}` : ""}`
        : `${p.email_confirmed_at ? "Подтвердил почту" : "Зарегистрировался"} ${day(p.email_confirmed_at ?? p.user_created_at ?? now.toISOString())}`;
    const tone = STAGES.find((s) => s.key === p.stage.key)!.tone;
    const label = STAGES.find((s) => s.key === p.stage.key)!.label;
    const note = filter === "contact" && p.last_note ? p.last_note : p.stage.note;
    const action = p.last_action_at
      ? {
          when: whenText(p.last_action_at, now),
          what: [actionLabel(p.last_action), p.kind === "shop" ? whoLabel(p.last_action_role, p.last_action_name) : null, agoText(p.last_action_at, now)]
            .filter(Boolean)
            .join(" · "),
        }
      : null;
    const digits = waPhone(p.phone);
    const contact =
      digits.length >= 9
        ? { href: `https://wa.me/${digits}?text=${encodeURIComponent(waText(p.stage.key, p.name))}`, label: "WhatsApp", icon: "💬" }
        : p.email
          ? { href: `mailto:${p.email}`, label: "Письмо", icon: "✉" }
          : null;
    return { p, link, title, sub, tone, label, note, action, contact };
  });

  return (
    <>
      <div className="adm-h1">
        <h1>{filter === "contact" ? "Связаться" : "Магазины"}</h1>
        <span className="muted">
          {filter === "contact"
            ? "Те, кому по заметке пора написать или позвонить."
            : "Клиенты и долги магазинов здесь не видны - только счётчики и контакты владельцев."}
        </span>
      </div>
      {filter === "contact" && dueRequests > 0 && (
        <p className="notice">
          И заявки, которым пора ответить: {dueRequests}. <Link href="/admin/feedback?f=contact">Открыть заявки →</Link>
        </p>
      )}
      <nav className="adm-chips" aria-label="Фильтр по этапу">
        <Link className={!filter ? "adm-chip on" : "adm-chip"} href={href({ f: null })}>
          <b>{people.length}</b>
          <span>Все</span>
        </Link>
        {STAGES.filter((s) => s.key !== "blocked" || counts.get("blocked")).map((s) => (
          <Link key={s.key} className={`adm-chip tone-${s.tone}${filter === s.key ? " on" : ""}`} href={href({ f: s.key })}>
            <b>{counts.get(s.key) ?? 0}</b>
            <span>{s.chip}</span>
          </Link>
        ))}
      </nav>
      <form className="adm-tools" action="/admin">
        {filter && <input type="hidden" name="f" value={filter} />}
        <input name="q" type="search" defaultValue={params.q ?? ""} placeholder="Поиск: название, email, телефон" maxLength={100} />
        <select name="sort" defaultValue={sort} aria-label="Сортировка">
          {Object.entries(SORTS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select name="type" defaultValue={type ?? ""} aria-label="Вид бизнеса">
          <option value="">Любой вид бизнеса</option>
          {Object.entries(PRESETS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className="button" type="submit">
          Показать
        </button>
        <span className="muted adm-count">
          {rows.length ? `Показаны ${(page - 1) * PAGE + 1}-${(page - 1) * PAGE + shown.length} из ${rows.length}` : "Никого не нашли"}
        </span>
      </form>

      {rows.length > 0 && (
        <div className="adm-grid">
          <div className="table-wrap adm-table">
            <table>
              <thead>
                <tr>
                  <th>Магазин / владелец</th>
                  <th>Этап</th>
                  <th className="adm-num">Записей за 7 дн.</th>
                  <th>Последнее действие</th>
                  <th>Оплата</th>
                  <th className="adm-act">Связаться</th>
                </tr>
              </thead>
              <tbody>
                {view.map(({ p, link, title, sub, tone, label, note, action, contact }) => (
                  <tr key={p.org_id ?? p.user_id}>
                    <td>
                      <Link className="adm-row-link" href={link}>
                        {title}
                      </Link>
                      <small>{sub}</small>
                    </td>
                    <td>
                      <span className={`adm-stage tone-${tone}`}>{label}</span>
                      {note && <small className="adm-flag">{note}</small>}
                    </td>
                    <td className="adm-num">{p.kind === "shop" ? p.records_7d : "-"}</td>
                    <td>
                      {action ? (
                        <>
                          <span className="adm-when">{action.when}</span>
                          <small>{action.what}</small>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{payText(p, today)}</td>
                    <td className="adm-act">
                      {contact && (
                        <a
                          className="adm-contact"
                          href={contact.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={contact.label}
                          title={contact.label}
                        >
                          <span aria-hidden="true">{contact.icon}</span>
                          <span className="adm-contact-text">{contact.label}</span>
                        </a>
                      )}
                      {p.phone && <small>{p.phone}</small>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="adm-cards">
            {view.map(({ p, link, title, tone, label, note, action, contact }) => (
              <li key={p.org_id ?? p.user_id}>
                <Link className="adm-row-link" href={link}>
                  {title}
                </Link>
                <span className={`adm-stage tone-${tone}`}>{label}</span>
                <small className={note ? "adm-flag" : undefined}>
                  {note ?? (p.kind === "shop" ? `${p.records_7d} записей за неделю` : "")}
                  {action ? ` · ${action.when}` : ""}
                </small>
                {contact && (
                  <a className="adm-contact" href={contact.href} target="_blank" rel="noopener noreferrer" aria-label={contact.label}>
                    {contact.icon}
                  </a>
                )}
                <small>
                  {payText(p, today)}
                  {p.phone ? ` · ${p.phone}` : ""}
                </small>
              </li>
            ))}
          </ul>
          {pages > 1 && (
            <nav className="adm-pager" aria-label="Страницы">
              <span>{PAGE} на странице</span>
              <div>
                {page > 1 && <Link href={href({ page: page - 1 })}>← Назад</Link>}
                {Array.from({ length: pages }, (_, i) => i + 1)
                  .filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2)
                  .map((n) => (
                    <Link key={n} className={n === page ? "on" : undefined} href={href({ page: n })}>
                      {n}
                    </Link>
                  ))}
                {page < pages && <Link href={href({ page: page + 1 })}>Дальше →</Link>}
              </div>
            </nav>
          )}
        </div>
      )}
    </>
  );
}
