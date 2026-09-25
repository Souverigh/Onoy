import { Icon } from "@/components/icon";
export default function Documents() {
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ФОТО → ПРОВЕРКА → ПОДТВЕРЖДЕНИЕ</span>
          <h1>Документы</h1>
          <p className="muted">Накладные и чеки вашего магазина.</p>
        </div>
        <span className="tag">Следующий этап</span>
      </div>
      <section className="panel empty">
        <span className="empty-icon">
          <Icon name="camera" />
        </span>
        <h2>Готовим работу с документами</h2>
        <p>
          Здесь появятся загрузка фото, распознавание ADRE и проверка
          результата.
          <br />
          Подключим их после ручного прихода, продажи и оплаты.
        </p>
      </section>
    </>
  );
}
