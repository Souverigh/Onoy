import { Submit } from "./submit";
import { createInvite, removeMember, renameMember, revokeInvite } from "@/app/(workspace)/settings/actions";

export type Member = { user_id: string; role: string; display_name: string | null; email: string | null };
export type Invite = { id: string; token: string; display_name: string; expires_at: string };

const statusText: Record<string, string> = {
  invited: "Приглашение создано — отправьте ссылку продавцу.",
  revoked: "Приглашение отменено.",
  removed: "Сотрудник удалён — больше не войдёт в магазин.",
  renamed: "Имя сохранено.",
  name: "Введите имя (до 80 символов).",
  limit: "Лимит тарифа исчерпан: продавцы вместе с неиспользованными приглашениями.",
  plan: "Сотрудники доступны на тарифе «Бизнес». Напишите в Depter, чтобы подключить.",
  error: "Не удалось выполнить действие. Обновите страницу и попробуйте снова.",
};

/** Сотрудники магазина (только владелец): приглашения по ссылке, имена, удаление. */
export function StaffPanel({
  members,
  invites,
  origin,
  shopName,
  currentUserId,
  status,
  plan,
  staffLimit,
  businessStaffLimit,
}: {
  members: Member[];
  invites: Invite[];
  origin: string;
  shopName: string;
  currentUserId: string;
  status?: string;
  plan: "basic" | "business";
  /** Сколько продавцов можно на тарифе магазина (plan_limits); нет — решает база. */
  staffLimit?: number;
  businessStaffLimit?: number;
}) {
  // Как в create_invite: продавцы + действующие приглашения.
  const used = members.filter((m) => m.role === "staff").length + invites.length;
  const full = staffLimit !== undefined && used >= staffLimit;
  const date = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "long" }).format(new Date(iso));
  return (
    <section className="panel staff-panel" id="staff">
      <h2>Сотрудники</h2>
      <p className="muted">
        Продавец оформляет продажи, приходы и оплаты. Отменять записи, делать скидки, подтверждать заявки,
        смотреть итоги и закрывать день может только владелец.
      </p>
      {status && statusText[status] && (
        <p className={["error", "name", "limit", "plan"].includes(status) ? "form-error" : "notice success"} role="status">
          {statusText[status]}
        </p>
      )}
      <ul className="staff-list">
        {members.map((m) => (
          <li key={m.user_id}>
            <form action={renameMember} className="staff-rename">
              <input type="hidden" name="user_id" value={m.user_id} />
              <input
                name="name"
                defaultValue={m.display_name ?? ""}
                placeholder={m.role === "owner" ? "Владелец" : "Имя"}
                maxLength={80}
                aria-label="Имя в журнале"
              />
              <button className="text-button" type="submit">
                Сохранить имя
              </button>
            </form>
            <span className="muted">
              {m.role === "owner" ? "владелец" : "продавец"}
              {m.email ? ` · ${m.email}` : ""}
              {m.user_id === currentUserId ? " · это вы" : ""}
            </span>
            {m.role === "staff" && (
              <form action={removeMember}>
                <input type="hidden" name="user_id" value={m.user_id} />
                <button className="text-button danger-text" type="submit">
                  Удалить
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      {invites.length > 0 && (
        <>
          <h3>Ждут вступления</h3>
          <ul className="staff-list">
            {invites.map((invite) => {
              const link = `${origin}/join/${invite.token}`;
              const text = `Здравствуйте, ${invite.display_name}! Вас пригласили в Depter, магазин «${shopName}». Откройте ссылку, чтобы начать работу: ${link}`;
              return (
                <li key={invite.id}>
                  <strong>{invite.display_name}</strong>
                  <span className="muted">ссылка действует до {date(invite.expires_at)}</span>
                  <code className="staff-link">{link}</code>
                  <span className="staff-actions">
                    <a
                      className="button primary"
                      href={`https://wa.me/?text=${encodeURIComponent(text)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Отправить в WhatsApp
                    </a>
                    <form action={revokeInvite}>
                      <input type="hidden" name="id" value={invite.id} />
                      <button className="text-button" type="submit">
                        Отменить приглашение
                      </button>
                    </form>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {staffLimit !== undefined && (
        <p className="muted staff-count">
          Продавцов: {used} из {staffLimit} · тариф «{plan === "business" ? "Бизнес" : "Базовый"}»
        </p>
      )}
      {!full ? (
        <form action={createInvite} className="staff-invite">
          <label>
            Пригласить продавца
            <input name="name" required maxLength={80} placeholder="Имя, например Айбек" />
          </label>
          <Submit>Создать ссылку</Submit>
        </form>
      ) : (
        <p className="notice">
          {plan === "basic" && businessStaffLimit !== undefined && businessStaffLimit > staffLimit!
            ? `На тарифе «Базовый» — до ${staffLimit} продавцов. На «Бизнес» — до ${businessStaffLimit}: напишите в Depter, чтобы подключить. `
            : `На вашем тарифе — до ${staffLimit} продавцов. `}
          Освободить место: удалите продавца или отмените приглашение.
        </p>
      )}
    </section>
  );
}
