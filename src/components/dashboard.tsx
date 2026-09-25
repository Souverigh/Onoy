import Link from "next/link";
import { Icon } from "./icon";
import { money } from "@/lib/format";
export type Summary = {
  sold: string | number;
  receivable: string | number;
  payable: string | number;
  low_stock: number;
  review: number;
};
export function Dashboard({
  summary,
  events = [],
  preview = false,
}: {
  summary: Summary;
  events?: { id: string; action: string; created_at: string }[];
  preview?: boolean;
}) {
  const href = (url: string) => (preview ? "/preview" : url);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ВАШ МАГАЗИН ПОД КОНТРОЛЕМ</span>
          <h1>Главная</h1>
          <p className="muted">Всё, что нужно знать перед началом дня.</p>
        </div>
        <Link href={href("/products/new")} className="button">
          <Icon name="plus" />
          Добавить товар
        </Link>
      </div>
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-label">
            <span />
            МЕНЬШЕ РУЧНОЙ РАБОТЫ
          </div>
          <h2>
            Сначала фото.
            <br />
            Потом порядок.
          </h2>
          <p>
            Приход, продажа и оплата по документу.
            <br />
            Вы проверяете данные и подтверждаете.
          </p>
          <Link className="button hero-button" href={href("/documents")}>
            <Icon name="camera" />
            Сфоткать документ
            <Icon name="arrow" />
          </Link>
          <small>Распознавание подключим на следующем этапе</small>
        </div>
        <div className="document-art" aria-hidden="true">
          <div className="paper">
            <div className="paper-top">
              <span>Oŋoy</span>
              <b>НАКЛАДНАЯ</b>
            </div>
            <div className="paper-lines">
              <i />
              <i />
              <i />
            </div>
            <div className="paper-table">
              <span>Наименование</span>
              <span>Кол-во</span>
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="paper-total">
              Итого <span>Проверить сумму</span>
            </div>
          </div>
          <div className="review-chip">
            <span>✓</span>
            <div>
              <strong>Вы решаете</strong>
              <small>Проверка перед сохранением</small>
            </div>
          </div>
        </div>
      </section>
      <section className="metrics" aria-label="Показатели магазина">
        {[
          [
            "Продано сегодня",
            money(summary.sold),
            "За день по Бишкеку",
            "wallet",
          ],
          ["Мне должны", money(summary.receivable), "Долги клиентов", "people"],
          [
            "Я должен поставщикам",
            money(summary.payable),
            "За полученный товар",
            "truck",
          ],
          [
            "Товаров заканчивается",
            String(summary.low_stock),
            "Ниже минимального остатка",
            "box",
          ],
        ].map(([label, value, hint, icon]) => (
          <article className="metric" key={label}>
            <div>
              <span>{label}</span>
              <Icon name={icon as "wallet"} />
            </div>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="section-title">
            <h2>Последние действия</h2>
            <span className="tag">История</span>
          </div>
          {events.length ? (
            <div className="activity-list">
              {events.map((e) => (
                <div className="activity" key={e.id}>
                  <span className="activity-icon">
                    <Icon name="home" />
                  </span>
                  <div>
                    <strong>
                      {(
                        { "organization.created": "Магазин создан" } as Record<
                          string,
                          string
                        >
                      )[e.action] ?? "Операция магазина"}
                    </strong>
                    <small>
                      {new Intl.DateTimeFormat("ru-RU", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "Asia/Bishkek",
                      }).format(new Date(e.created_at))}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="file" />
              </span>
              <h3>Здесь появится история магазина</h3>
              <p>Проведённые операции будут видны в одном месте.</p>
            </div>
          )}
        </section>
        <section className="panel start-panel">
          <div className="section-title">
            <h2>С чего начать</h2>
            <span className="tag green">Первые шаги</span>
          </div>
          {[
            [
              "1",
              "Добавьте товары",
              "Название, цена и минимальный остаток",
              "/products",
            ],
            [
              "2",
              "Запишите клиентов",
              "Имя и телефон всегда под рукой",
              "/customers",
            ],
            [
              "3",
              "Добавьте поставщика",
              "Подготовьтесь к первому приходу",
              "/suppliers",
            ],
          ].map(([n, title, desc, url]) => (
            <Link key={n} href={href(url)} className="start-step">
              <span className="step-number">{n}</span>
              <div>
                <strong>{title}</strong>
                <small>{desc}</small>
              </div>
              <Icon name="arrow" />
            </Link>
          ))}
        </section>
      </div>
      <div className="bottom-note">
        <span className="status-dot" />
        Данные сохраняются только после вашего подтверждения
        <span>Oŋoy · Просто работать</span>
      </div>
    </>
  );
}
