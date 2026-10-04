import { requirePlatformAdmin } from "@/lib/admin";
import { bishkekDate } from "@/lib/day-summary";
import { Submit } from "@/components/submit";
import { subscriptionState } from "@/lib/subscription";
import { setBlocked, setPlan } from "./actions";

type Shop = {
  id: string;
  name: string;
  created_at: string;
  owner_email: string | null;
  plan: "basic" | "business";
  paid_until: string | null;
  blocked_at: string | null;
  blocked_reason: string | null;
  members: number;
  staff: number;
  customers: number;
  records_7d: number;
  records_30d: number;
  last_activity: string | null;
  gemini_cost: string;
  signup_code: string | null;
};

/** Переходы по рекламному QR с накладных магазина (admin_promo_clicks). */
type PromoClicks = { organization_id: string; clicks_7d: number; clicks_30d: number; clicks_total: number };

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

/** ТЗ, метрика пилота: активная точка — ≥ 3 операций в неделю. */
const ACTIVE_PER_WEEK = 3;

export default async function AdminShops({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { db } = await requirePlatformAdmin();
  const { saved, error } = await searchParams;
  const [{ data, error: loadError }, promo] = await Promise.all([db.rpc("admin_shops"), db.rpc("admin_promo_clicks")]);
  if (loadError) throw new Error("Не удалось загрузить магазины");
  const shops = (data ?? []) as Shop[];
  // Миграция переходов ещё не применена — показываем прочерк.
  const clicks = promo.error ? null : new Map(((promo.data ?? []) as PromoClicks[]).map((c) => [c.organization_id, c]));
  const today = bishkekDate();
  const active = shops.filter((s) => !s.blocked_at && s.records_7d >= ACTIVE_PER_WEEK).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Магазины</h1>
          <p className="muted">
            Всего {shops.length} · активных на этой неделе (≥ {ACTIVE_PER_WEEK} записей): {active}. Клиенты и
            долги магазинов здесь не видны — только счётчики.
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "reason" ? "Укажите причину блокировки (до 300 символов)." : "Не удалось сохранить."}
        </p>
      )}
      <div className="admin-shops">
        {shops.map((s) => {
          const sub = subscriptionState(s.paid_until, s.blocked_reason, Boolean(s.blocked_at), today);
          return (
            <section key={s.id} id={`shop-${s.id}`} className={`panel admin-shop${s.blocked_at ? " blocked" : ""}`}>
              <div className="admin-shop-head">
                <div>
                  <h2>{s.name}</h2>
                  <p className="muted">
                    {s.owner_email ?? "владелец без email"} · создан {date(s.created_at)}
                    {s.signup_code ? ` · код ${s.signup_code}` : ""}
                  </p>
                </div>
                <div className="admin-tags">
                  {s.blocked_at && <span className="tag reversed-tag">заблокирован</span>}
                  {!s.blocked_at && s.records_7d >= ACTIVE_PER_WEEK && <span className="tag green">активен</span>}
                  <span className="tag">{s.plan === "business" ? "Бизнес" : "Базовый"}</span>
                  {sub.kind === "grace" && <span className="tag reversed-tag">льготная неделя</span>}
                  {sub.kind === "expired" && <span className="tag reversed-tag">только просмотр (не оплачено)</span>}
                  {sub.kind === "ending" && <span className="tag">оплата кончается</span>}
                  {saved === s.id && <span className="tag green">сохранено</span>}
                </div>
              </div>
              <dl className="admin-stats">
                <div>
                  <dt>Записей за 7 / 30 дней</dt>
                  <dd>
                    {s.records_7d} / {s.records_30d}
                  </dd>
                </div>
                <div>
                  <dt>Последняя активность</dt>
                  <dd>{s.last_activity ? date(s.last_activity) : "—"}</dd>
                </div>
                <div>
                  <dt>Участников (продавцов)</dt>
                  <dd>
                    {s.members} ({s.staff})
                  </dd>
                </div>
                <div>
                  <dt>Клиентов</dt>
                  <dd>{s.customers}</dd>
                </div>
                <div>
                  <dt>Переходы по QR с накладных: 7 / 30 дней / всего</dt>
                  <dd>
                    {clicks
                      ? `${clicks.get(s.id)?.clicks_7d ?? 0} / ${clicks.get(s.id)?.clicks_30d ?? 0} / ${clicks.get(s.id)?.clicks_total ?? 0}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Gemini, $</dt>
                  <dd>{Number(s.gemini_cost).toFixed(2)}</dd>
                </div>
              </dl>
              {s.blocked_at && (
                <p className="form-error">
                  Заблокирован {date(s.blocked_at)}: {s.blocked_reason}
                </p>
              )}
              <div className="admin-forms">
                <form action={setPlan} className="admin-form">
                  <input type="hidden" name="org" value={s.id} />
                  <label>
                    Тариф
                    <select name="plan" defaultValue={s.plan}>
                      <option value="basic">Базовый (2 000 сом)</option>
                      <option value="business">Бизнес (5 000 сом)</option>
                    </select>
                  </label>
                  <label>
                    Оплачено до
                    <input type="date" name="paid_until" defaultValue={s.paid_until ?? ""} />
                  </label>
                  <Submit>Сохранить тариф</Submit>
                </form>
                {s.blocked_at ? (
                  <form action={setBlocked} className="admin-form">
                    <input type="hidden" name="org" value={s.id} />
                    <input type="hidden" name="blocked" value="false" />
                    <Submit>Разблокировать</Submit>
                  </form>
                ) : (
                  <form action={setBlocked} className="admin-form">
                    <input type="hidden" name="org" value={s.id} />
                    <input type="hidden" name="blocked" value="true" />
                    <label>
                      Причина блокировки
                      <input name="reason" required maxLength={300} placeholder="Например: не оплачен октябрь" />
                    </label>
                    <button className="button danger-text" type="submit">
                      Заблокировать
                    </button>
                  </form>
                )}
              </div>
            </section>
          );
        })}
        {!shops.length && <p className="muted">Магазинов пока нет.</p>}
      </div>
    </>
  );
}
