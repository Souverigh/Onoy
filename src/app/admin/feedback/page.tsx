import { requirePlatformAdmin } from "@/lib/admin";

/** Заявки со страницы входа (send_feedback → admin_feedback). */
type Message = { id: number; name: string; contact: string; message: string; created_at: string };

const when = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Bishkek",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

export default async function AdminFeedback() {
  const { db } = await requirePlatformAdmin();
  const { data, error } = await db.rpc("admin_feedback");
  const messages = (data ?? []) as Message[];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Заявки</h1>
          <p className="muted">Сообщения со страницы входа - от новых магазинов. Последние 300.</p>
        </div>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          Не удалось загрузить заявки. Применена ли миграция 20261004110000_feedback.sql?
        </p>
      ) : (
        <div className="admin-shops">
          {messages.map((m) => (
            <section key={m.id} className="panel admin-shop">
              <div className="admin-shop-head">
                <div>
                  <h2>{m.name}</h2>
                  <p className="muted">
                    {m.contact} · {when(m.created_at)}
                  </p>
                </div>
              </div>
              <p className="admin-feedback-text">{m.message}</p>
            </section>
          ))}
          {!messages.length && <p className="muted">Заявок пока нет.</p>}
        </div>
      )}
    </>
  );
}
