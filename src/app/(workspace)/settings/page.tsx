import { headers } from "next/headers";
import { LogoutButton } from "@/components/logout-button";
import { getContext } from "@/lib/context";
import { StaffPanel, type Invite, type Member } from "@/components/staff-panel";
import { Submit } from "@/components/submit";
import { updateShop } from "./actions";
import { EXPORT_TABLES } from "@/lib/export-data";

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; staff?: string }>;
}) {
  const { db, organizationId, organizationName, user, isOwner, plan, paidUntil, currency } = await getContext();
  const { saved, error, staff } = await searchParams;
  // Сотрудники и приглашения — только владельцу (RLS тоже не отдаст продавцу).
  let members: Member[] = [];
  let invites: Invite[] = [];
  // Сколько продавцов можно по тарифам (таблица plan_limits, меняется в SQL).
  let staffLimits: Record<string, number> = {};
  let origin = "";
  // Магазин — параллельно с сотрудниками, а не после них. Запрос supabase-js
  // уходит только при .then/await — .then запускает его сразу.
  const orgRequest = db
    .from("organizations")
    .select("phone,block_duplicate_photos,document_names")
    .eq("id", organizationId)
    .maybeSingle()
    .then((result) => result);
  if (isOwner) {
    const [m, i, l] = await Promise.all([
      db
        .from("organization_members")
        .select("user_id,role,display_name,email")
        .eq("organization_id", organizationId)
        .order("created_at"),
      db
        .from("organization_invites")
        .select("id,token,display_name,expires_at")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
      db.from("plan_limits").select("plan,max_staff"),
    ]);
    members = (m.data ?? []) as Member[];
    invites = (i.data ?? []) as Invite[];
    staffLimits = Object.fromEntries(
      ((l.data ?? []) as { plan: string; max_staff: number }[]).map((row) => [row.plan, row.max_staff]),
    );
    const h = await headers();
    origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  }
  const org = await orgRequest;
  const planName = plan === "business" ? "Бизнес" : "Базовый";

  const sections = [
    { id: "shop", label: "Магазин" },
    { id: "documents", label: "Накладные" },
    ...(isOwner
      ? [
          { id: "staff", label: "Сотрудники" },
          { id: "export", label: "Выгрузка" },
        ]
      : []),
    { id: "account", label: "Аккаунт" },
  ];

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p className="muted">Магазин, сотрудники и ваш аккаунт.</p>
        </div>
      </div>
      <div className="settings">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="settings-body">
          {saved && (
            <p className="notice success" role="status">
              Сохранено.
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error === "currency_locked"
                ? "Валюту магазина нельзя сменить: записи уже есть. Остальное не сохранено — попробуйте ещё раз без смены валюты."
                : "Не удалось сохранить. Проверьте название, телефон и названия в накладных (до 20 строк)."}
            </p>
          )}

          {/* Магазин и накладные — одна форма (updateShop сохраняет всё сразу). */}
          <form action={updateShop} className="settings-form">
            <section className="panel settings-card" id="shop">
              <header>
                <h2>Магазин</h2>
                <p className="muted">Так вас видят клиенты в накладных и сообщениях.</p>
              </header>
              <label>
                Название магазина
                <input name="name" required maxLength={120} defaultValue={organizationName} />
              </label>
              <div className="settings-row">
                <label>
                  Телефон для WhatsApp
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    placeholder="+996 700 000000"
                    defaultValue={org.data?.phone ?? ""}
                  />
                </label>
                <label>
                  Основная валюта
                  <select name="currency" defaultValue={currency}>
                    <option value="KGS">Сом</option>
                    <option value="RUB">Рубль</option>
                    <option value="USD">Доллар</option>
                  </select>
                </label>
              </div>
              <small className="muted settings-hint">
                Валюту можно сменить, пока нет ни одной записи. Клиенту или поставщику в другой валюте
                задайте её в его карточке.
              </small>
            </section>

            <section className="panel settings-card" id="documents">
              <header>
                <h2>Накладные</h2>
                <p className="muted">Как приложение распознаёт фото накладных.</p>
              </header>
              <label>
                Как ваш магазин написан в накладных
                <textarea
                  name="document_names"
                  rows={3}
                  placeholder={"Маликнур\nD MALIKNUR SATAROV"}
                  defaultValue={((org.data?.document_names as string[] | null) ?? []).join("\n")}
                />
                <small className="muted">
                  Необязательно. По строке на вариант — как на печати, в шапке или от руки. Так приложение
                  отличает продажу от прихода и не путает ваш магазин с клиентом.
                </small>
              </label>
              <label className="setting-switch">
                <span>
                  <strong>Не принимать одно фото дважды</strong>
                  <small className="muted">
                    Если выключить — запись с уже использованным фото сохранится, но с предупреждением.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  name="block_duplicate_photos"
                  defaultChecked={org.data?.block_duplicate_photos ?? true}
                />
              </label>
            </section>

            <div className="settings-save">
              <Submit>Сохранить изменения</Submit>
            </div>
          </form>

          {isOwner && (
            <StaffPanel
              members={members}
              invites={invites}
              origin={origin}
              shopName={organizationName}
              currentUserId={user.id}
              status={staff}
              plan={plan === "business" ? "business" : "basic"}
              staffLimit={staffLimits[plan === "business" ? "business" : "basic"]}
              businessStaffLimit={staffLimits.business}
            />
          )}

          {isOwner && (
            <section className="panel settings-card" id="export">
              <header>
                <h2>Выгрузка в Excel</h2>
                <p className="muted">
                  Все записи магазина, включая отменённые (с пометкой). Даты — по Бишкеку, суммы — числами.
                </p>
              </header>
              <a className="button primary settings-export-all" href="/export">
                Скачать всю базу
              </a>
              <div className="settings-export-tables">
                <span className="muted">Или отдельно:</span>
                {Object.entries(EXPORT_TABLES).map(([key, label]) => (
                  <a key={key} href={`/export?table=${key}`}>
                    {label}
                  </a>
                ))}
              </div>
            </section>
          )}

          <section className="panel settings-card" id="account">
            <header>
              <h2>Аккаунт</h2>
            </header>
            <dl className="settings-details">
              <dt>Email</dt>
              <dd>{user.email}</dd>
              <dt>Тариф</dt>
              <dd>
                {planName}
                {paidUntil
                  ? ` · оплачено до ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${paidUntil}T12:00:00+06:00`))}`
                  : ""}
              </dd>
              <dt>Часовой пояс</dt>
              <dd>Бишкек (UTC+6)</dd>
            </dl>
            <div className="settings-account-footer">
              <LogoutButton />
              <small className="muted">Depter 0.3</small>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
