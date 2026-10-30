import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/admin";
import { loadFeedback } from "@/lib/admin-data";
import { FEEDBACK_STATUSES, feedbackWaText } from "@/lib/admin-feedback";
import { whenText } from "@/lib/admin-people";
import { AdminNotes, type AdminNote } from "@/components/admin-notes";
import { FeedbackContactButtons, feedbackContact } from "@/components/admin-feedback-contact";
import { setFeedbackStatus } from "../../../actions";

const DONE: Record<string, [string, boolean]> = {
  status: ["Статус сохранён.", true],
  note: ["Заметка сохранена.", true],
  note_error: ["Заметка не сохранилась: текст до 2000 символов.", false],
  error: ["Не удалось сохранить.", false],
};

/** Одна заявка: полный текст, контакт, статус, заметки с «связаться снова». */
export default async function AdminFeedbackItem({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  if (!/^\d{1,15}$/.test(id)) notFound();
  const { db } = await requirePlatformAdmin();
  const [all, notes] = await Promise.all([loadFeedback(db), db.rpc("admin_feedback_notes", { p_id: Number(id) })]);
  const f = all.find((x) => x.id === Number(id));
  if (!f) notFound();
  const status = FEEDBACK_STATUSES.find((s) => s.key === f.status)!;
  const contact = feedbackContact(f);
  const message = done ? DONE[done] : null;

  return (
    <>
      <Link className="adm-back" href="/admin/feedback">
        ← Все заявки
      </Link>
      <div className="adm-shop-head">
        <h1>{f.name}</h1>
        <p className="muted">Заявка со страницы входа · {whenText(f.created_at)}</p>
        <span className={`adm-stage tone-${status.tone}`}>{status.label}</span>
      </div>
      {message && (
        <p className={message[1] ? "notice success" : "form-error"} role={message[1] ? "status" : "alert"}>
          {message[0]}
        </p>
      )}
      <div className="adm-cols">
        <div>
          <section className="adm-card">
            <h2>Сообщение</h2>
            <p className="adm-full-text">{f.message}</p>
          </section>
          <section className="adm-card">
            <h2>Контакт</h2>
            <div className="adm-contact-row">
              <span>{contact.email ? "Email" : "Телефон"}</span>
              <div>{f.contact}</div>
              <FeedbackContactButtons f={f} />
            </div>
            <div className="adm-contact-row">
              <span>В Depter</span>
              <div>
                {f.match_org ? (
                  <Link href={`/admin/shop/${f.match_org}`}>{f.match_name} →</Link>
                ) : f.match_user ? (
                  <Link href={`/admin/account/${f.match_user}`}>{f.match_name} (без магазина) →</Link>
                ) : (
                  <span className="muted">аккаунта с этим телефоном или email пока нет</span>
                )}
              </div>
              <div />
            </div>
          </section>
        </div>
        <div>
          <section className="adm-card">
            <h2>Статус</h2>
            <form action={setFeedbackStatus} className="adm-status-row">
              <input type="hidden" name="feedback" value={f.id} />
              {FEEDBACK_STATUSES.map((s) => (
                <button key={s.key} className={`button${s.key === f.status ? " on" : ""}`} name="status" value={s.key} aria-pressed={s.key === f.status}>
                  {s.button}
                </button>
              ))}
            </form>
            {contact.phone && (
              <small className="muted adm-hint">
                WhatsApp откроется с текстом: «{feedbackWaText(f.name)}» - после отправки поставьте «Написали».
              </small>
            )}
          </section>
          <AdminNotes notes={(notes.data ?? []) as AdminNote[]} feedback={f.id} />
        </div>
      </div>
    </>
  );
}
