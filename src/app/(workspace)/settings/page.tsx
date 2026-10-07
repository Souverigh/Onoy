import { headers } from "next/headers";
import { LogoutButton } from "@/components/logout-button";
import { getContext } from "@/lib/context";
import { StaffPanel, type Invite, type Member } from "@/components/staff-panel";
import { Submit } from "@/components/submit";
import { NoAutofillInput } from "@/components/no-autofill-input";
import { changeEmail, changePassword, updateShop } from "./actions";
import { EXPORT_TABLES } from "@/lib/export-data";

/** Итог смены пароля / email (?account=… от settings/actions.ts и /auth/confirm). */
const ACCOUNT_TEXT: Record<string, string> = {
  password_changed: "Пароль изменён. На других устройствах нужно войти заново.",
  email_sent: "Письмо со ссылкой отправлено на новый адрес.",
  email_half: "Одна ссылка подтверждена. Откройте письмо и на второй почте - тогда email сменится.",
  email_changed: "Email изменён - теперь входите с новым адресом.",
  current: "Текущий пароль не подошёл.",
  short: "Новый пароль - не короче 6 символов.",
  mismatch: "Новые пароли не совпадают.",
  same: "Новый пароль совпадает со старым.",
  weak: "Слишком простой пароль - добавьте цифры или буквы.",
  email_invalid: "Проверьте новый email.",
  email_same: "Это ваш текущий email.",
  email_taken: "Этот email уже занят другим аккаунтом.",
  email_current: "Пароль не подошёл - email не изменён.",
  rate: "Слишком много попыток. Подождите несколько минут и повторите.",
  link: "Ссылка из письма устарела или уже открыта. Попробуйте ещё раз.",
  failed: "Не получилось. Обновите страницу и попробуйте снова.",
};
const ACCOUNT_OK = new Set(["password_changed", "email_sent", "email_half", "email_changed"]);
const PASSWORD_ERRORS = new Set(["current", "short", "mismatch", "same", "weak"]);
const EMAIL_ERRORS = new Set(["email_invalid", "email_same", "email_taken", "email_current"]);

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; staff?: string; account?: string; to?: string }>;
}) {
  const { db, organizationId, organizationName, user, isOwner, plan, paidUntil, currency } = await getContext();
  const { saved, error, staff, account, to } = await searchParams;
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
  // Продавец, реквизиты и накладная (задача 34) — отдельным запросом: пока
  // миграция не применена, колонок нет, а остальные настройки работают.
  const sellerResult = await db
    .from("organizations")
    .select("seller_name,seller_phone,address,pay_mbank,pay_optima,pay_odengi,pay_qr_image,invoice_show_debt,invoice_show_qr")
    .eq("id", organizationId)
    .maybeSingle();
  const seller = (sellerResult.error ? null : sellerResult.data) as {
    seller_name: string;
    seller_phone: string;
    address: string;
    pay_mbank: string;
    pay_optima: string;
    pay_odengi: string;
    pay_qr_image: string | null;
    invoice_show_debt: boolean;
    invoice_show_qr: boolean;
  } | null;
  const planName = plan === "business" ? "Бизнес" : "Базовый";

  const sections = [
    { id: "shop", label: "Магазин" },
    { id: "pay", label: "Реквизиты" },
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
                ? "Валюту магазина нельзя сменить: записи уже есть. Остальное не сохранено - попробуйте ещё раз без смены валюты."
                : error === "qr"
                  ? "QR не сохранён: нужна картинка (фото или скриншот) не больше 4 МБ."
                  : error === "migration"
                    ? "Название и телефон сохранены, а продавец и реквизиты - нет: базу ещё не обновили. Напишите Ержану."
                    : "Не удалось сохранить. Проверьте название, телефоны и названия в накладных (до 20 строк)."}
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
              <div className="settings-row">
                <label>
                  Имя продавца (для накладной)
                  <input name="seller_name" maxLength={80} placeholder="Маликнур" defaultValue={seller?.seller_name ?? ""} />
                </label>
                <label>
                  Телефон продавца (для накладной)
                  <input
                    name="seller_phone"
                    type="tel"
                    maxLength={40}
                    placeholder="+996 773 033 399"
                    defaultValue={seller?.seller_phone ?? ""}
                  />
                </label>
              </div>
              <label>
                Адрес (необязательно)
                <input name="address" maxLength={200} placeholder="Рынок «Дордой», ряд 5, контейнер 12" defaultValue={seller?.address ?? ""} />
              </label>
            </section>

            <section className="panel settings-card" id="pay">
              <header>
                <h2>Реквизиты для оплаты</h2>
                <p className="muted">Клиент видит их на своей странице в «Оплатить». Пустые не показываются.</p>
              </header>
              <div className="settings-row">
                <label>
                  MBank
                  <input name="pay_mbank" maxLength={60} inputMode="tel" placeholder="Номер телефона или счёта" defaultValue={seller?.pay_mbank ?? ""} />
                </label>
                <label>
                  Optima
                  <input name="pay_optima" maxLength={60} inputMode="tel" placeholder="Номер телефона или карты" defaultValue={seller?.pay_optima ?? ""} />
                </label>
              </div>
              <label>
                О!Деньги
                <input name="pay_odengi" maxLength={60} inputMode="tel" placeholder="Номер телефона" defaultValue={seller?.pay_odengi ?? ""} />
              </label>
              <div className="settings-qr">
                <span>QR магазина для оплаты</span>
                {seller?.pay_qr_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={seller.pay_qr_image} alt="QR для оплаты" />
                )}
                <input name="pay_qr" type="file" accept="image/*" />
                {seller?.pay_qr_image && (
                  <label className="cash-toggle">
                    <input type="checkbox" name="pay_qr_remove" />
                    Убрать QR
                  </label>
                )}
                <small className="muted">Сфотографируйте наклейку с QR из банка или загрузите скриншот.</small>
              </div>
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
                  Необязательно. По строке на вариант - как на печати, в шапке или от руки. Так приложение
                  отличает продажу от товара от поставщика и не путает ваш магазин с клиентом.
                </small>
              </label>
              <label className="setting-switch">
                <span>
                  <strong>Не принимать одно фото дважды</strong>
                  <small className="muted">
                    Если выключить - запись с уже использованным фото сохранится, но с предупреждением.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  name="block_duplicate_photos"
                  defaultChecked={org.data?.block_duplicate_photos ?? true}
                />
              </label>
              <label className="setting-switch">
                <span>
                  <strong>«Долг после этой накладной» на накладной</strong>
                  <small className="muted">Мелко под суммой - клиент сразу видит общий долг.</small>
                </span>
                <input type="checkbox" role="switch" name="invoice_show_debt" defaultChecked={seller?.invoice_show_debt ?? true} />
              </label>
              <label className="setting-switch">
                <span>
                  <strong>QR на страницу клиента на накладной</strong>
                  <small className="muted">По нему клиент открывает свои накладные, долг и «Оплатить».</small>
                </span>
                <input type="checkbox" role="switch" name="invoice_show_qr" defaultChecked={seller?.invoice_show_qr ?? true} />
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
                  Все записи магазина, включая отменённые (с пометкой). Даты - по Бишкеку, суммы - числами.
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
            {account && ACCOUNT_TEXT[account] && (
              <p
                className={ACCOUNT_OK.has(account) ? "notice success" : "form-error"}
                role={ACCOUNT_OK.has(account) ? "status" : "alert"}
              >
                {account === "email_sent" && to
                  ? `Письмо со ссылкой отправлено на ${to}. Откройте его - после подтверждения входите с новым email. До этого - со старым.`
                  : ACCOUNT_TEXT[account]}
              </p>
            )}
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
            <details className="party-fold settings-fold" open={PASSWORD_ERRORS.has(account ?? "")}>
              <summary>
                <span>
                  <strong>Сменить пароль</strong>
                  <small className="muted">Нужен текущий пароль. На других устройствах выйдет из аккаунта.</small>
                </span>
              </summary>
              <form action={changePassword} className="settings-account-form">
                <label>
                  Текущий пароль
                  <NoAutofillInput name="current" type="password" required maxLength={1024} />
                </label>
                <div className="settings-row">
                  <label>
                    Новый пароль
                    <NoAutofillInput name="password" type="password" required minLength={6} maxLength={1024} />
                  </label>
                  <label>
                    Повторите новый
                    <NoAutofillInput name="repeat" type="password" required minLength={6} maxLength={1024} />
                  </label>
                </div>
                <small className="muted">Не короче 6 символов.</small>
                <div className="actions">
                  <Submit>Сменить пароль</Submit>
                </div>
              </form>
            </details>
            <details className="party-fold settings-fold" open={EMAIL_ERRORS.has(account ?? "")}>
              <summary>
                <span>
                  <strong>Сменить email</strong>
                  <small className="muted">Придёт письмо со ссылкой на новый адрес - email сменится после неё.</small>
                </span>
              </summary>
              <form action={changeEmail} className="settings-account-form">
                <label>
                  Новый email
                  <NoAutofillInput name="email" type="email" required maxLength={254} />
                </label>
                <label>
                  Текущий пароль
                  <NoAutofillInput name="current" type="password" required maxLength={1024} />
                </label>
                <div className="actions">
                  <Submit>Отправить ссылку</Submit>
                </div>
              </form>
            </details>
            <div className="settings-account-footer">
              <LogoutButton />
              <small className="muted">Depter {process.env.NEXT_PUBLIC_APP_VERSION ?? ""}</small>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
