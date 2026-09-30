import Link from "next/link";
import { money } from "@/lib/format";
import { UnclosedDays } from "@/components/unclosed-days";
import type { RecentRecord } from "@/lib/recent";

/** Долги по валютам: первая — валюта магазина, дальше — другие (Хороз в $). */
export type DebtTotals = { currency: string; receivable: number; payable: number }[];
export type Summary = { debts: DebtTotals };

/** «3 заявки», «1 заявка», «5 заявок» — склонение (аудит ТЗ 15.1 п. 18). */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/**
 * Главный экран (ТЗ §7, экран 2; аудит 15.1 п. 7): «Мне должны / Я должен»
 * (кликаются), Продажа / Приход / Оплата / Расход, ждущие заявки, итог дня за
 * сегодня, накладные с расхождением, поиск клиента, последние записи.
 * Продавцу — без сумм магазина (роли, п. 45).
 */
export function Dashboard({
  summary,
  preview = false,
  unclosedDays = [],
  overdue,
  staff = false,
  ownerOnlyNotice = false,
  today,
  pendingClaims = 0,
  reviewCount = 0,
  recent = [],
}: {
  summary: Summary | null;
  events?: { id: string; action: string; created_at: string }[];
  preview?: boolean;
  /** Прошлые дни с записями, которые не закрыли (напоминание). */
  unclosedDays?: string[];
  /** Клиенты с неоплаченными продажами старше 30 дней и сумма этой части долга. */
  overdue?: { count: number; amounts: { currency: string; amount: number }[] };
  /** Продавец: итогов магазина не видит (ТЗ), только действия. */
  staff?: boolean;
  /** Продавец открыл владельческую страницу — объясняем, почему вернули сюда. */
  ownerOnlyNotice?: boolean;
  /** Продано и собрано за сегодня (для кнопки «Итог дня»). */
  today?: { sold: number; collected: number; expenses: number; currency: string };
  pendingClaims?: number;
  /** Накладные с расхождением или ошибкой распознавания — «незавершённые». */
  reviewCount?: number;
  recent?: RecentRecord[];
}) {
  const href = (url: string) => (preview ? "/preview" : url);
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  return (
    <div className="simple-dashboard">
      {ownerOnlyNotice && (
        <p className="notice" role="status">
          Этот раздел доступен только владельцу магазина.
        </p>
      )}
      {!staff && pendingClaims > 0 && (
        <Link className="notice claims-notice" href={href("/claims")}>
          Ждут подтверждения: {pendingClaims} {plural(pendingClaims, "оплата", "оплаты", "оплат")} →
        </Link>
      )}
      {!staff && <UnclosedDays days={unclosedDays} />}
      {!staff && overdue && overdue.count > 0 && (
        <Link className="notice claims-notice" href={href("/customers?overdue=30")}>
          Просрочено больше 30 дней: {overdue.count} {plural(overdue.count, "клиент", "клиента", "клиентов")},{" "}
          {overdue.amounts.map((a) => money(a.amount, a.currency)).join(" + ")} →
        </Link>
      )}
      {!staff && summary && (
        <section className="debt-cards" aria-label="Долги">
          <Link className="debt-card" href={href("/customers")}>
            <span>Мне должны</span>
            <strong>{money(summary.debts[0]?.receivable ?? 0, summary.debts[0]?.currency)}</strong>
            {summary.debts.slice(1).filter((d) => d.receivable !== 0).map((d) => (
              <small key={d.currency} className="debt-extra">+ {money(d.receivable, d.currency)}</small>
            ))}
            <small>Клиенты →</small>
          </Link>
          <Link className="debt-card supplier-debt" href={href("/suppliers")}>
            <span>Я должен</span>
            <strong>{money(summary.debts[0]?.payable ?? 0, summary.debts[0]?.currency)}</strong>
            {summary.debts.slice(1).filter((d) => d.payable !== 0).map((d) => (
              <small key={d.currency} className="debt-extra">+ {money(d.payable, d.currency)}</small>
            ))}
            <small>Поставщикам →</small>
          </Link>
        </section>
      )}
      <section className="quick-actions" aria-label="Добавить запись">
        <Link className="quick-action" href={href("/money/new?type=sale")}>
          Продажа
        </Link>
        <Link className="quick-action" href={href("/money/new?type=purchase")}>
          Приход
        </Link>
        <Link className="quick-action secondary-action" href={href("/money/new?type=payment")}>
          Оплата
        </Link>
        <Link className="quick-action secondary-action" href={href("/money/expense")}>
          Расход
        </Link>
      </section>
      {!staff && today && (
        <Link className="dashboard-day" href={href("/day")}>
          <span>
            <strong>Итог дня</strong>
            <small className="muted">
              продано {money(today.sold, today.currency)} · собрано {money(today.collected, today.currency)}
              {today.expenses > 0 && <> · расходы {money(today.expenses, today.currency)}</>}
            </small>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
      {reviewCount > 0 && (
        <Link className="notice" href={href("/documents")}>
          Проверить накладные: {reviewCount} {plural(reviewCount, "накладная", "накладные", "накладных")} с
          расхождением или ошибкой →
        </Link>
      )}
      <form className="search dashboard-search" action={href("/customers")}>
        <label htmlFor="dashboard-search" className="sr-only">
          Найти клиента
        </label>
        <input id="dashboard-search" name="q" placeholder="Найти клиента…" maxLength={100} />
        <button className="button">Найти</button>
      </form>
      {recent.length > 0 && (
        <section className="panel dashboard-recent">
          <div className="section-title">
            <h2>Последние записи</h2>
            <Link className="button" href={href("/money")}>
              Все записи
            </Link>
          </div>
          <ul className="recent-list">
            {recent.map((r) => (
              <li key={r.key} className={r.reversed ? "reversed-row" : ""}>
                <span>
                  <strong>{r.label}</strong>
                  {r.reversed && <span className="tag reversed-tag">отменена</span>}
                  <small className="muted">
                    {r.partyHref ? <Link href={href(r.partyHref)}>{r.party}</Link> : r.party} · {time(r.at)}
                  </small>
                </span>
                <strong className="nowrap">{money(r.amount, r.currency)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
