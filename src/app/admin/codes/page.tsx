import { headers } from "next/headers";
import { requirePlatformAdmin } from "@/lib/admin";
import { Submit } from "@/components/submit";
import { createCode, deleteCode } from "../actions";

type Code = {
  code: string;
  note: string | null;
  created_at: string;
  used_at: string | null;
  organization_id: string | null;
  shop_name: string | null;
};

const date = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  );

// Коды доступа: без кода новый магазин не создать (миграция shop_signup_codes).
export default async function AdminCodes({
  searchParams,
}: {
  searchParams: Promise<{ created?: string; deleted?: string; error?: string }>;
}) {
  const { db } = await requirePlatformAdmin();
  const { created, deleted, error } = await searchParams;
  const { data, error: loadError } = await db.rpc("admin_codes");
  if (loadError) throw new Error("Не удалось загрузить коды");
  const codes = (data ?? []) as Code[];
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const newCode = created && /^[0-9A-F]{10}$/.test(created) ? created : null;
  const message = newCode
    ? `Здравствуйте! Ваш код для подключения магазина к Depter: ${newCode}. Зарегистрируйтесь на ${origin}/signup и введите код при создании магазина.`
    : "";

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Коды доступа</h1>
          <p className="muted">Один код — один новый магазин. Продавцам код не нужен: их приглашает владелец.</p>
        </div>
      </div>
      {newCode && (
        <section className="panel admin-new-code">
          <p>
            Код создан: <strong className="admin-code">{newCode}</strong>
          </p>
          <a className="button primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            Отправить в WhatsApp
          </a>
        </section>
      )}
      {deleted && (
        <p className="notice success" role="status">
          Код удалён.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error === "note" ? "Напишите, для кого код (до 200 символов)." : "Не удалось выполнить действие."}
        </p>
      )}
      <section className="panel">
        <form action={createCode} className="admin-form">
          <label>
            Для кого
            <input name="note" required maxLength={200} placeholder="Например: Малик, Манас" />
          </label>
          <Submit>Создать код</Submit>
        </form>
      </section>
      <section className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Код</th>
                <th>Для кого</th>
                <th>Создан</th>
                <th>Использован</th>
                <th>
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>{c.note}</td>
                  <td>{date(c.created_at)}</td>
                  <td>{c.used_at ? `${date(c.used_at)} · ${c.shop_name ?? "магазин"}` : "свободен"}</td>
                  <td>
                    {!c.used_at && (
                      <form action={deleteCode}>
                        <input type="hidden" name="code" value={c.code} />
                        <button className="text-button danger-text" type="submit">
                          Удалить
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!codes.length && <p className="muted">Кодов пока нет.</p>}
      </section>
    </>
  );
}
