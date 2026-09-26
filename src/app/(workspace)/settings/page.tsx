import { getContext } from "@/lib/context";
import { Submit } from "@/components/submit";
import { updateShop } from "./actions";

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { db, organizationId, organizationName, user } = await getContext();
  const { saved, error } = await searchParams;
  const org = await db
    .from("organizations")
    .select("phone,block_duplicate_photos")
    .eq("id", organizationId)
    .maybeSingle();

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p className="muted">Ваш рабочий кабинет.</p>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Сохранено.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          Не удалось сохранить. Проверьте название и телефон.
        </p>
      )}
      <section className="panel form-panel">
        <form action={updateShop} className="entry-form">
          <label>
            Название магазина
            <input name="name" required maxLength={120} defaultValue={organizationName} />
          </label>
          <label>
            Телефон магазина (для WhatsApp клиентам)
            <input
              name="phone"
              type="tel"
              maxLength={40}
              placeholder="+996 700 000000"
              defaultValue={org.data?.phone ?? ""}
            />
          </label>
          <label className="cash-toggle">
            <input
              type="checkbox"
              name="block_duplicate_photos"
              defaultChecked={org.data?.block_duplicate_photos ?? true}
            />
            Не принимать одно фото накладной дважды
          </label>
          <p className="muted">
            Если выключить — запись с уже использованным фото сохранится, но
            приложение предупредит о дубликате.
          </p>
          <div className="actions">
            <Submit>Сохранить</Submit>
          </div>
        </form>
      </section>
      <section className="panel">
        <dl className="details">
          <dt>Пользователь</dt>
          <dd>{user.email}</dd>
          <dt>Валюта</dt>
          <dd>Кыргызский сом (KGS)</dd>
          <dt>Часовой пояс</dt>
          <dd>Бишкек (UTC+6)</dd>
          <dt>Версия</dt>
          <dd>0.3 · Долги, фото-основание, сторно, заявки, ссылка клиента</dd>
        </dl>
      </section>
    </>
  );
}
