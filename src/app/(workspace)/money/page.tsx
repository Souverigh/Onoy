import Link from "next/link";
export default function Money() {
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Деньги</h1>
          <p className="muted">Долги клиентов и расчёты с поставщиками.</p>
        </div>
        <span className="tag">Операции: следующий этап</span>
      </div>
      <section className="panel">
        <h2>Подготовьте контрагентов</h2>
        <p className="muted">
          Проведение оплат появится вместе с ручными продажами и приходом.
        </p>
        <div className="actions">
          <Link href="/customers" className="button">
            Клиенты
          </Link>
          <Link href="/suppliers" className="button">
            Поставщики
          </Link>
        </div>
      </section>
    </>
  );
}
