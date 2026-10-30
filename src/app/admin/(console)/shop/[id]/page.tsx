import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { ACTIVE_PER_WEEK, STAGES, actionLabel, stageOf, waText, whenText, whoLabel } from "@/lib/admin-people";
import { subscriptionState } from "@/lib/subscription";
import { bishkekDate } from "@/lib/day-summary";
import { PRESETS, isBusinessType } from "@/lib/business";
import { waPhone } from "@/lib/share";
import { DateField } from "@/components/date-picker";
import { Submit } from "@/components/submit";
import { Turnstile } from "@/components/turnstile";
import { AdminNotes, type AdminNote } from "@/components/admin-notes";
import { extendShop, sendPasswordLink, resendConfirmation, setBlocked, setPlan, setShopBusiness } from "../../../actions";

/** admin_shop: магазин без клиентов и сумм — контакты, шаги, действия, счётчики. */
type Shop = {
  id: string;
  name: string;
  business_type: string | null;
  created_at: string;
  phone: string;
  seller_name: string;
  plan: "basic" | "business";
  paid_until: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  owner_id: string | null;
  owner_email: string | null;
  owner_created_at: string | null;
  owner_confirmed_at: string | null;
  trial: boolean;
  members: { user_id: string; role: "owner" | "staff"; name: string | null; email: string | null; last_sign_in_at: string | null }[];
  customers: number;
  first_customer_at: string | null;
  first_record_at: string | null;
  records_7d: number;
  records_30d: number;
  documents: number;
  extractions: number;
  gemini_cost: number;
  actions: { at: string | null; action: string; role: "owner" | "staff"; who: string | null }[];
};

const DONE: Record<string, [string, boolean]> = {
  plan: ["Тариф сохранён.", true],
  trial: ["Пробный период продлён.", true],
  paid: ["Оплата отмечена.", true],
  business: ["Вид бизнеса изменён. Владелец увидит новые разделы при следующем открытии.", true],
  blocked: ["Магазин заблокирован.", true],
  unblocked: ["Магазин разблокирован.", true],
  note: ["Заметка сохранена.", true],
  password_link: ["Письмо со ссылкой для смены пароля отправлено владельцу.", true],
  confirm_sent: ["Письмо подтверждения отправлено ещё раз.", true],
  reason: ["Укажите причину блокировки (до 300 символов).", false],
  captcha: ["Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз.", false],
  rate: ["Письма уже отправлялись недавно. Подождите несколько минут.", false],
  mail_error: ["Письмо не отправилось. Попробуйте ещё раз.", false],
  note_error: ["Заметка не сохранилась: текст до 2000 символов.", false],
  error: ["Не удалось сохранить.", false],
};

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", year: "numeric" })
    .format(new Date(iso))
    .replace(" г.", "");
const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short" }).format(new Date(iso)).replace(".", "");

export default async function AdminShop({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { db } = await requirePlatformAdmin();
  const [shopResult, notesResult, promo] = await Promise.all([
    db.rpc("admin_shop", { p_org: id }),
    db.rpc("admin_notes", { p_org: id, p_user: null }),
    db.rpc("admin_promo_clicks"),
  ]);
  if (shopResult.error) notFound();
  const s = shopResult.data as Shop;
  const notes = (notesResult.data ?? []) as AdminNote[];
  const clicks = ((promo.data ?? []) as { organization_id: string; clicks_30d: number; clicks_total: number }[]).find(
    (c) => c.organization_id === id,
  );
  const today = bishkekDate();
  const sub = subscriptionState(s.paid_until, s.blocked_reason, Boolean(s.blocked_at), today);
  const stage = stageOf(
    {
      kind: "shop",
      email_confirmed_at: s.owner_confirmed_at,
      records_7d: s.records_7d,
      first_record_at: s.first_record_at,
      trial: s.trial,
    } as Parameters<typeof stageOf>[0],
    sub,
  );
  const stageInfo = STAGES.find((x) => x.key === stage.key)!;
  const business = isBusinessType(s.business_type) ? s.business_type : "shop";
  const owner = s.members.find((m) => m.role === "owner");
  const staff = s.members.filter((m) => m.role === "staff");
  const phone = waPhone(s.phone);
  const actions = s.actions.filter((a) => a.at).slice(0, 10);
  const message = done ? DONE[done] : null;

  const steps: { label: string; done: boolean; info: string }[] = [
    { label: "Зарегистрировался", done: Boolean(s.owner_created_at), info: s.owner_created_at ? shortDate(s.owner_created_at) : "" },
    { label: "Подтвердил почту", done: Boolean(s.owner_confirmed_at), info: s.owner_confirmed_at ? shortDate(s.owner_confirmed_at) : "" },
    { label: "Создал магазин", done: true, info: shortDate(s.created_at) },
    { label: "Добавил клиентов", done: s.customers > 0, info: s.customers ? `${s.customers} клиент.` : "пока нет" },
    { label: "Первая запись", done: Boolean(s.first_record_at), info: s.first_record_at ? shortDate(s.first_record_at) : "пока нет" },
    {
      label: `Пишет ${ACTIVE_PER_WEEK}+ записи в неделю`,
      done: s.records_7d >= ACTIVE_PER_WEEK,
      info: `сейчас ${s.records_7d} за неделю`,
    },
    {
      label: "Оплатил",
      done: !s.trial,
      info: s.trial ? (s.paid_until ? `пробный до ${shortDate(`${s.paid_until}T12:00:00Z`)}` : "пробный") : s.paid_until ? `до ${shortDate(`${s.paid_until}T12:00:00Z`)}` : "без срока",
    },
  ];
  const current = steps.findIndex((x) => !x.done);

  return (
    <>
      <Link className="adm-back" href="/admin">
        ← Все магазины
      </Link>
      <div className="adm-shop-head">
        <h1>{s.name}</h1>
        <p className="muted">
          {PRESETS[business].label} · создан {date(s.created_at)} · тариф {s.plan === "business" ? "Бизнес" : "Базовый"}
        </p>
        <span className={`adm-stage tone-${stageInfo.tone}`}>
          {stageInfo.label}
          {stage.note ? ` - ${stage.note}` : ""}
        </span>
      </div>
      {message && (
        <p className={message[1] ? "notice success" : "form-error"} role={message[1] ? "status" : "alert"}>
          {message[0]}
        </p>
      )}
      <div className="adm-cols">
        <div>
          <section className="adm-card">
            <h2>Контакты</h2>
            <div className="adm-contact-row">
              <span>Владелец</span>
              <div>
                {s.seller_name || owner?.name ? `${s.seller_name || owner?.name} · ` : ""}
                {s.owner_email ?? "без email"}
              </div>
              <div className="adm-contact-acts">
                {s.owner_email && (
                  <a className="adm-contact" href={`mailto:${s.owner_email}`}>
                    ✉ Письмо
                  </a>
                )}
              </div>
            </div>
            <div className="adm-contact-row">
              <span>Телефон</span>
              <div>{s.phone || "не указан"}</div>
              <div className="adm-contact-acts">
                {phone.length >= 9 && (
                  <>
                    <a
                      className="adm-contact"
                      href={`https://wa.me/${phone}?text=${encodeURIComponent(waText(stage.key, s.name))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      💬 WhatsApp
                    </a>
                    <a className="adm-contact" href={`tel:+${phone}`}>
                      📞 Позвонить
                    </a>
                  </>
                )}
              </div>
            </div>
            <div className="adm-contact-row">
              <span>Продавцы ({staff.length})</span>
              <div>
                {staff.length
                  ? staff.map((m) => (
                      <div key={m.user_id}>
                        {m.name ?? "продавец"} · {m.email ?? "без email"}
                        {m.last_sign_in_at ? ` · вход ${whenText(m.last_sign_in_at)}` : " · ещё не входил"}
                      </div>
                    ))
                  : "нет"}
              </div>
              <div />
            </div>
          </section>

          <section className="adm-card">
            <h2>Где сейчас</h2>
            <ol className="adm-steps">
              {steps.map((step, i) => (
                <li key={step.label} className={step.done ? "done" : i === current ? "now" : "todo"}>
                  <i aria-hidden="true">{step.done ? "✓" : i === current ? "!" : i + 1}</i>
                  {step.label}
                  <small>{step.info}</small>
                </li>
              ))}
            </ol>
          </section>

          <section className="adm-card">
            <h2>Последние действия</h2>
            {actions.length ? (
              <ul className="adm-log">
                {actions.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    <b>{whenText(a.at!)}</b>
                    <span>{actionLabel(a.action)}</span>
                    <small>{whoLabel(a.role, a.who)}</small>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Действий пока нет.</p>
            )}
            <small className="muted">Только вид действия, время и кто - без клиентов и сумм.</small>
          </section>

          <section className="adm-card">
            <h2>Счётчики</h2>
            <dl className="adm-stats">
              <div>
                <dt>Записей 7 / 30 дн.</dt>
                <dd>
                  {s.records_7d} / {s.records_30d}
                </dd>
              </div>
              <div>
                <dt>Клиентов</dt>
                <dd>{s.customers}</dd>
              </div>
              <div>
                <dt>Последнее действие</dt>
                <dd>{actions[0]?.at ? whenText(actions[0].at) : "-"}</dd>
              </div>
              <div>
                <dt>Фото: документов / распознано</dt>
                <dd>
                  {s.documents} / {s.extractions}
                </dd>
              </div>
              <div>
                <dt>Переходы по QR 30 дн. / всего</dt>
                <dd>{clicks ? `${clicks.clicks_30d} / ${clicks.clicks_total}` : "0 / 0"}</dd>
              </div>
              <div>
                <dt>Gemini, $</dt>
                <dd>{Number(s.gemini_cost).toFixed(2)}</dd>
              </div>
            </dl>
          </section>
        </div>

        <div>
          <section className="adm-card">
            <h2>Помочь</h2>
            <div className="adm-label">Оплата и пробный период</div>
            <div className="adm-pay">
              <span>Оплачено до</span>
              <b>
                {s.paid_until ? date(`${s.paid_until}T12:00:00Z`) : "без срока"}
                {s.trial ? " (пробный)" : ""}
              </b>
            </div>
            <form action={extendShop} className="adm-actions">
              <input type="hidden" name="org" value={s.id} />
              <button className="button" name="extend" value="trial:7">
                Продлить пробный <small>+7 дней</small>
              </button>
              <button className="button" name="extend" value="trial:14">
                Продлить пробный <small>+14 дней</small>
              </button>
              <button className="button" name="extend" value="paid:1">
                Оплатил <small>+1 месяц</small>
              </button>
              <button className="button" name="extend" value="paid:3">
                Оплатил <small>+3 месяца</small>
              </button>
            </form>

            <div className="adm-label">Вход и почта</div>
            <div className="adm-actions">
              <form action={sendPasswordLink}>
                <input type="hidden" name="org" value={s.id} />
                <Turnstile />
                <button className="button" disabled={!s.owner_email}>
                  Ссылка для смены пароля
                </button>
              </form>
              {!s.owner_confirmed_at && (
                <form action={resendConfirmation}>
                  <input type="hidden" name="org" value={s.id} />
                  <Turnstile />
                  <button className="button">Письмо подтверждения</button>
                </form>
              )}
            </div>

            <div className="adm-label">Магазин</div>
            <details className="adm-fold">
              <summary>Сменить вид бизнеса</summary>
              <form action={setShopBusiness} className="adm-inline-form">
                <input type="hidden" name="org" value={s.id} />
                <select name="business_type" defaultValue={business} aria-label="Вид бизнеса">
                  {Object.entries(PRESETS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <Submit>Сменить</Submit>
              </form>
              <small className="muted">Свои настройки разделов у магазина сбросятся на разделы нового вида.</small>
            </details>
            <details className="adm-fold">
              <summary>Сменить тариф или дату вручную</summary>
              <form action={setPlan} className="adm-inline-form">
                <input type="hidden" name="org" value={s.id} />
                <label>
                  Тариф
                  <select name="plan" defaultValue={s.plan}>
                    <option value="basic">Базовый</option>
                    <option value="business">Бизнес</option>
                  </select>
                </label>
                <DateField
                  name="paid_until"
                  label="Оплачено до"
                  defaultValue={s.paid_until ?? ""}
                  emptyLabel="Без срока"
                  maxDaysBack={3650}
                  max={new Date(Date.now() + 3650 * 86400000).toISOString().slice(0, 10)}
                />
                <Submit>Сохранить</Submit>
              </form>
            </details>
          </section>

          <AdminNotes notes={notes} org={s.id} />

          <section className="adm-card adm-danger">
            {s.blocked_at ? (
              <>
                <p className="form-error">
                  Заблокирован {date(s.blocked_at)}: {s.blocked_reason}
                </p>
                <form action={setBlocked}>
                  <input type="hidden" name="org" value={s.id} />
                  <input type="hidden" name="blocked" value="false" />
                  <Submit>Разблокировать</Submit>
                </form>
              </>
            ) : (
              <details>
                <summary>Заблокировать магазин…</summary>
                <form action={setBlocked} className="adm-inline-form">
                  <input type="hidden" name="org" value={s.id} />
                  <input type="hidden" name="blocked" value="true" />
                  <label>
                    Причина
                    <input name="reason" required maxLength={300} placeholder="Например: не оплачен октябрь" />
                  </label>
                  <button className="button danger-outline" type="submit">
                    Заблокировать
                  </button>
                </form>
                <small className="muted">Записи станут только для просмотра; страницы клиентов продолжат открываться.</small>
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
