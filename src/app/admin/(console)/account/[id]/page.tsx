import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { STAGES, whenText } from "@/lib/admin-people";
import { PRESETS, isBusinessType } from "@/lib/business";
import { Turnstile } from "@/components/turnstile";
import { AdminNotes, type AdminNote } from "@/components/admin-notes";
import { resendConfirmation, sendPasswordLink } from "../../../actions";

type Account = {
  id: string;
  email: string | null;
  created_at: string;
  confirmed_at: string | null;
  last_sign_in_at: string | null;
  business_type: string | null;
  shop_id: string | null;
};

const DONE: Record<string, [string, boolean]> = {
  note: ["Заметка сохранена.", true],
  password_link: ["Письмо со ссылкой для смены пароля отправлено.", true],
  confirm_sent: ["Письмо подтверждения отправлено ещё раз.", true],
  captcha: ["Не прошла проверка «я не робот». Подождите пару секунд и нажмите ещё раз.", false],
  rate: ["Письма уже отправлялись недавно. Подождите несколько минут.", false],
  mail_error: ["Письмо не отправилось. Попробуйте ещё раз.", false],
  note_error: ["Заметка не сохранилась: текст до 2000 символов.", false],
};

/** Человек без магазина: зарегистрировался, но не подтвердил почту или не создал магазин. */
export default async function AdminAccount({
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
  const [accountResult, notesResult] = await Promise.all([
    db.rpc("admin_account", { p_user: id }),
    db.rpc("admin_notes", { p_org: null, p_user: id }),
  ]);
  if (accountResult.error) notFound();
  const a = accountResult.data as Account;
  if (a.shop_id) redirect(`/admin/shop/${a.shop_id}`);
  const notes = (notesResult.data ?? []) as AdminNote[];
  const stage = STAGES.find((s) => s.key === (a.confirmed_at ? "no_shop" : "unconfirmed"))!;
  const message = done ? DONE[done] : null;
  const steps = [
    { label: "Зарегистрировался", at: a.created_at },
    { label: "Подтвердил почту", at: a.confirmed_at },
    { label: "Создал магазин", at: null },
  ];
  const current = steps.findIndex((s) => !s.at);

  return (
    <>
      <Link className="adm-back" href="/admin">
        ← Все магазины
      </Link>
      <div className="adm-shop-head">
        <h1>{a.email ?? "без email"}</h1>
        <p className="muted">
          Аккаунт без магазина
          {isBusinessType(a.business_type) ? ` · пришёл со страницы «${PRESETS[a.business_type].label}»` : ""}
        </p>
        <span className={`adm-stage tone-${stage.tone}`}>{stage.label}</span>
      </div>
      {message && (
        <p className={message[1] ? "notice success" : "form-error"} role={message[1] ? "status" : "alert"}>
          {message[0]}
        </p>
      )}
      <div className="adm-cols">
        <div>
          <section className="adm-card">
            <h2>Где сейчас</h2>
            <ol className="adm-steps">
              {steps.map((s, i) => (
                <li key={s.label} className={s.at ? "done" : i === current ? "now" : "todo"}>
                  <i aria-hidden="true">{s.at ? "✓" : i === current ? "!" : i + 1}</i>
                  {s.label}
                  <small>{s.at ? whenText(s.at) : "пока нет"}</small>
                </li>
              ))}
            </ol>
            <p className="muted adm-hint">
              Последний вход: {a.last_sign_in_at ? whenText(a.last_sign_in_at) : "ещё не входил"}. Телефона нет - он
              появляется, когда создают магазин.
            </p>
          </section>
          <section className="adm-card">
            <h2>Помочь</h2>
            <div className="adm-actions">
              {a.email && (
                <a className="button" href={`mailto:${a.email}`}>
                  ✉ Написать письмо
                </a>
              )}
              {!a.confirmed_at && (
                <form action={resendConfirmation}>
                  <input type="hidden" name="user" value={a.id} />
                  <Turnstile />
                  <button className="button">Письмо подтверждения ещё раз</button>
                </form>
              )}
              <form action={sendPasswordLink}>
                <input type="hidden" name="user" value={a.id} />
                <Turnstile />
                <button className="button">Ссылка для смены пароля</button>
              </form>
            </div>
          </section>
        </div>
        <div>
          <AdminNotes notes={notes} user={a.id} />
        </div>
      </div>
    </>
  );
}
