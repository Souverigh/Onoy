import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { whenText } from "@/lib/admin-people";
import { Submit } from "@/components/submit";
import { ConfirmButton } from "@/components/confirm-button";
import { addAdmin, removeAdmin, removeAdminKey } from "../../actions";

type Admin = {
  user_id: string;
  email: string | null;
  added_at: string;
  last_sign_in_at: string | null;
  has_mfa: boolean;
};

const MESSAGES: Record<string, [string, boolean]> = {
  added: [
    "Админ добавлен. При первом входе на depter.kg/admin он подключит Google Authenticator.",
    true,
  ],
  removed: ["Админ убран из команды.", true],
  email: ["Впишите email.", false],
  no_account: [
    "Аккаунта с таким email нет. Пусть сначала зарегистрируется на depter.kg/signup (магазин создавать не нужно).",
    false,
  ],
  already_admin: ["Этот человек уже в команде.", false],
  self: ["Себя убрать нельзя - это сделает другой админ.", false],
  save: ["Не удалось сохранить.", false],
  key_added: [
    "Телефон подключён - теперь входить можно с любого из ваших телефонов.",
    true,
  ],
  key_removed: ["Телефон отключён - его коды больше не подходят.", true],
  last_key: [
    "Последний телефон отключить нельзя - иначе не войти. Сначала подключите другой.",
    false,
  ],
  key: ["Не удалось отключить телефон. Обновите страницу.", false],
};

/** Команда Depter: кто может входить в админку. */
export default async function AdminTeam({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { db, user } = await requirePlatformAdmin();
  const { done, error } = await searchParams;
  const [{ data }, factors] = await Promise.all([
    db.rpc("admin_team"),
    db.auth.mfa.listFactors(),
  ]);
  const team = (data ?? []) as Admin[];
  const keys = factors.data?.totp ?? [];
  const message = MESSAGES[done ?? error ?? ""];
  return (
    <>
      <div className="adm-h1">
        <h1>Команда</h1>
        <span className="muted">
          Кто может входить в админку. Вход - только с кодом из Google
          Authenticator.
        </span>
      </div>
      {message && (
        <p
          className={message[1] ? "notice success" : "form-error"}
          role={message[1] ? "status" : "alert"}
        >
          {message[0]}
        </p>
      )}
      <div className="adm-cols">
        <div>
          <section className="adm-card">
            <h2>Мой второй ключ</h2>
            <ul className="adm-team">
              {keys.map((k) => (
                <li key={k.id}>
                  <div>
                    <strong>{k.friendly_name || "Телефон"}</strong>
                    <small>подключён {whenText(k.created_at)}</small>
                  </div>
                  {keys.length > 1 && (
                    <form action={removeAdminKey}>
                      <input type="hidden" name="factor" value={k.id} />
                      <ConfirmButton
                        className="button danger-outline"
                        message={`Отключить «${k.friendly_name || "Телефон"}»? Коды с этого телефона перестанут подходить.`}
                        confirmLabel="Отключить"
                      >
                        Отключить
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <Link className="button primary adm-key-add" href="/admin/team/key">
              + Подключить ещё телефон
            </Link>
            <small className="muted adm-hint">
              Два телефона - запасной ключ: потеряли один, входите со второго.
              Последний отключить нельзя.
            </small>
          </section>
          <section className="adm-card">
            <h2>Админы ({team.length})</h2>
            <ul className="adm-team">
              {team.map((a) => (
                <li key={a.user_id}>
                  <div>
                    <strong>{a.email ?? "без email"}</strong>
                    {a.user_id === user.id && (
                      <span className="adm-stage tone-gray">это вы</span>
                    )}
                    <small>
                      {a.has_mfa
                        ? "второй ключ подключён"
                        : "второй ключ ещё не подключён"}{" "}
                      · вход{" "}
                      {a.last_sign_in_at
                        ? whenText(a.last_sign_in_at)
                        : "ещё не входил"}
                    </small>
                  </div>
                  {a.user_id !== user.id && (
                    <form action={removeAdmin}>
                      <input type="hidden" name="user" value={a.user_id} />
                      <ConfirmButton
                        className="button danger-outline"
                        message={`Убрать ${a.email ?? "этого админа"} из команды? Он больше не сможет войти в админку.`}
                        confirmLabel="Убрать"
                      >
                        Убрать
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="adm-card">
          <h2>Добавить админа</h2>
          <ol className="adm-mfa-steps">
            <li>
              Человек регистрируется на depter.kg/signup и подтверждает почту.
              Магазин создавать не нужно.
            </li>
            <li>Вы вписываете его email ниже.</li>
            <li>
              Он заходит на depter.kg/admin и подключает Google Authenticator по
              QR-коду.
            </li>
          </ol>
          <form action={addAdmin} className="adm-inline-form">
            <label>
              Email его аккаунта Depter
              <input name="email" type="email" required maxLength={254} />
            </label>
            <Submit>Добавить</Submit>
          </form>
          <small className="muted">
            Админ видит контакты владельцев и счётчики магазинов, но не клиентов
            и суммы.
          </small>
        </section>
      </div>
    </>
  );
}
