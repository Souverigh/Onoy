import Link from "next/link";
import { money } from "@/lib/format";
import { UnclosedDays } from "@/components/unclosed-days";

export type Summary = {
  sold: string | number;
  receivable: string | number;
  payable: string | number;
  low_stock: number;
  review: number;
};

export function Dashboard({
  summary,
  preview = false,
  unclosedDays = [],
}: {
  summary: Summary;
  events?: { id: string; action: string; created_at: string }[];
  preview?: boolean;
  /** Прошлые дни с записями, которые не закрыли (напоминание). */
  unclosedDays?: string[];
}) {
  const href = (url: string) => (preview ? "/preview" : url);
  return (
    <div className="simple-dashboard">
      <header className="simple-dashboard-heading">
        <h1>Долги магазина</h1>
        <p>Все записи — только после вашего подтверждения.</p>
      </header>
      <UnclosedDays days={unclosedDays} />
      <section className="debt-cards" aria-label="Долги">
        <article className="debt-card">
          <span>Мне должны</span>
          <strong>{money(summary.receivable)}</strong>
          <small>Клиенты</small>
        </article>
        <article className="debt-card supplier-debt">
          <span>Я должен</span>
          <strong>{money(summary.payable)}</strong>
          <small>Поставщикам</small>
        </article>
      </section>
      <section className="quick-actions" aria-label="Добавить запись">
        <Link
          className="quick-action"
          href={href("/money/new?type=sale")}
        >
          Продажа
        </Link>
        <Link
          className="quick-action"
          href={href("/money/new?type=purchase")}
        >
          Приход
        </Link>
        <Link
          className="quick-action secondary-action"
          href={href("/money/new?type=payment")}
        >
          Оплата
        </Link>
      </section>
      <Link className="simple-dashboard-history" href={href("/money")}>
        Посмотреть все записи
      </Link>
    </div>
  );
}
