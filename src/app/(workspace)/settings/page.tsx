import { getContext } from "@/lib/context";
export default async function Settings() {
  const ctx = await getContext();
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p className="muted">Ваш рабочий кабинет.</p>
        </div>
      </div>
      <section className="panel">
        <dl className="details">
          <dt>Магазин</dt>
          <dd>{ctx.organizationName}</dd>
          <dt>Пользователь</dt>
          <dd>{ctx.user.email}</dd>
          <dt>Валюта</dt>
          <dd>Кыргызский сом (KGS)</dd>
          <dt>Часовой пояс</dt>
          <dd>Бишкек (UTC+6)</dd>
          <dt>Версия</dt>
          <dd>0.1 · Основа и справочники</dd>
        </dl>
      </section>
    </>
  );
}
