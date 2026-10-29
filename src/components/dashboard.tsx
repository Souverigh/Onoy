import Link from "next/link";
import { quickActions, DEFAULT_BUSINESS, MODULE_IDS, type QuickAction } from "@/lib/business";
import { Icon } from "./action-icon";
import { debtMoney, money } from "@/lib/format";
import type { RecentRecord } from "@/lib/recent";

/** Долги по валютам: первая — валюта магазина, дальше — другие (Хороз в $). */
export type DebtTotals = { currency: string; receivable: number; payable: number }[];
export type Summary = { debts: DebtTotals };

/** Клиент в «Кому напомнить сегодня»: обещал оплатить сегодня (или раньше) или долг старше 30 дней. */
export type Reminder = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  /** «обещал сегодня», «обещал до 3 октября», «долг 45 дн.» */
  reason: string;
  /** WhatsApp с готовым текстом; нет телефона — откроем карточку. */
  waHref: string | null;
};

/** «3 заявки», «1 заявка», «5 заявок» — склонение (аудит ТЗ 15.1 п. 18). */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Другая валюта под главной суммой: «+ 55 816,76 $» или «аванс 3 229,99 ₽». */
function extraDebt(value: number, currency: string) {
  return value < 0 ? debtMoney(value, currency) : `+ ${money(value, currency)}`;
}

/**
 * Главный экран (задачи 17, 20, 33): шапка (день, итог дня, поиск), долги,
 * сразу под ними — что ждёт ответа («Требуют внимания»), кнопки, внизу рядом
 * «Кому напомнить сегодня» и последние записи. Незакрытые дни — только в «Итоге дня». Продавцу — без
 * сумм магазина (роли, п. 45).
 */
export function Dashboard({
  summary,
  preview = false,
  reminders = [],
  remindersMore = 0,
  staff = false,
  ownerOnlyNotice = false,
  today,
  pendingClaims = 0,
  reviewCount = 0,
  newOrders = 0,
  rentals = { late: 0, today: 0 },
  actions = quickActions(DEFAULT_BUSINESS, MODULE_IDS),
  recent = [],
  mySales,
  intro,
}: {
  summary: Summary | null;
  preview?: boolean;
  /** Кому напомнить сегодня — первые несколько. */
  reminders?: Reminder[];
  /** Сколько ещё не показано в «Кому напомнить». */
  remindersMore?: number;
  /** Продавец: итогов магазина не видит (ТЗ), только действия. */
  staff?: boolean;
  /** Продавец открыл владельческую страницу — объясняем, почему вернули сюда. */
  ownerOnlyNotice?: boolean;
  /** Продано и собрано за сегодня (для кнопки «Итог дня»). */
  today?: { sold: number; collected: number; expenses: number; currency: string };
  pendingClaims?: number;
  /** Накладные с записью, где сумма не сошлась или фото не прочиталось. */
  reviewCount?: number;
  /** Новые заказы клиентов из каталога (задача № 12). */
  newOrders?: number;
  /** Прокат: выдачи с просроченным возвратом и те, что вернуть сегодня. */
  rentals?: { late: number; today: number };
  /** Кнопки под вид бизнеса (quickActions): блоками по клиентам и поставщикам, расход — тонкой строкой. */
  actions?: QuickAction[];
  recent?: RecentRecord[];
  /** Продавец: его продажи за сегодня и сколько должны его клиенты. */
  mySales?: { date: string; today: number; todayCount: number; owed: number; currency: string };
  /** Новый магазин: «Первые шаги» — над карточками долгов. */
  intro?: React.ReactNode;
}) {
  const href = (url: string) => (preview ? "/preview" : url);
  const time = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(
      new Date(iso),
    );
  const main = summary?.debts[0];
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Bishkek", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(),
  );
  const dayTitle = day.charAt(0).toUpperCase() + day.slice(1);
  const expense = actions.find((a) => a.side === "shop");
  const first = actions.find((a) => a !== expense);
  const groups = (
    [
      { side: "customers", title: "С клиентами" },
      { side: "suppliers", title: "С поставщиками" },
    ] as const
  )
    .map((g) => ({ ...g, items: actions.filter((a) => a.side === g.side) }))
    .filter((g) => g.items.length > 0);
  const attention: { href: string; text: string; urgent?: boolean }[] = [];
  if (!staff && pendingClaims > 0)
    attention.push({
      href: "/claims",
      text: `Ждут подтверждения: ${pendingClaims} ${plural(pendingClaims, "оплата", "оплаты", "оплат")}`,
      urgent: true,
    });
  if (newOrders > 0) attention.push({ href: "/orders", text: `Заказы из каталога ждут продажи: ${newOrders}`, urgent: true });
  if (rentals.late > 0 || rentals.today > 0)
    attention.push({
      href: "/rentals",
      text: `Прокат: ${[rentals.late > 0 && `просрочено ${rentals.late}`, rentals.today > 0 && `вернуть сегодня ${rentals.today}`]
        .filter(Boolean)
        .join(" · ")}`,
      urgent: rentals.late > 0,
    });
  if (reviewCount > 0)
    attention.push({
      href: "/documents",
      text: `Проверьте сумму: ${reviewCount} ${plural(reviewCount, "накладная", "накладные", "накладных")}`,
    });
  return (
    <div className="simple-dashboard">
      {ownerOnlyNotice && (
        <p className="notice" role="status">
          Этот раздел доступен только владельцу магазина.
        </p>
      )}
      {/* Шапка: день и итог дня одной строкой, поиск клиента справа (на телефоне —
          значок, поиск открывается в «Клиентах»). */}
      <header className="home-head">
        <div>
          <h1>{dayTitle}</h1>
          {!staff && today ? (
            <Link className="home-today" href={href("/day")}>
              Сегодня: продано {money(today.sold, today.currency)} · собрано {money(today.collected, today.currency)}
              {today.expenses > 0 && <> · расходы {money(today.expenses, today.currency)}</>}
              <span className="home-today-go"> · Итог дня →</span>
            </Link>
          ) : null}
        </div>
        <form className="search dashboard-search home-search" action={href("/customers")}>
          <label htmlFor="dashboard-search" className="sr-only">
            Найти клиента
          </label>
          <input id="dashboard-search" name="q" placeholder="Имя или телефон клиента" maxLength={100} />
          <button className="button">Найти</button>
        </form>
        <Link className="home-search-icon" href={href("/customers")} aria-label="Найти клиента">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" />
          </svg>
        </Link>
      </header>
      {intro}
      {!staff && summary && (
        <section className="debt-cards" aria-label="Долги">
          <Link className="debt-card" href={href("/customers")}>
            <span>
              Мне должны<span className="debt-who"> клиенты</span>
            </span>
            <strong>{debtMoney(main?.receivable ?? 0, main?.currency)}</strong>
            {summary.debts.slice(1).filter((d) => d.receivable !== 0).map((d) => (
              <small key={d.currency} className="debt-extra">{extraDebt(d.receivable, d.currency)}</small>
            ))}
            <small>Клиенты →</small>
          </Link>
          <Link className="debt-card supplier-debt" href={href("/suppliers")}>
            <span>
              Я должен<span className="debt-who"> поставщикам</span>
            </span>
            <strong>{debtMoney(main?.payable ?? 0, main?.currency)}</strong>
            {summary.debts.slice(1).filter((d) => d.payable !== 0).map((d) => (
              <small key={d.currency} className="debt-extra">{extraDebt(d.payable, d.currency)}</small>
            ))}
            <small>Поставщики →</small>
          </Link>
        </section>
      )}
      {/* Продавец: свои продажи — первым, как карточки долгов у владельца. */}
      {staff && mySales && (
        <section className="debt-cards" aria-label="Мои продажи">
          <Link className="debt-card" href={href(`/sellers?date=${mySales.date}`)}>
            <span>Мои продажи сегодня</span>
            <strong>{money(mySales.today, mySales.currency)}</strong>
            <small>
              {mySales.todayCount} {plural(mySales.todayCount, "продажа", "продажи", "продаж")} →
            </small>
          </Link>
          <Link className="debt-card" href={href("/sellers?tab=debts#details")}>
            <span>Мне должны</span>
            <strong>{debtMoney(mySales.owed, mySales.currency)}</strong>
            <small>Мои клиенты →</small>
          </Link>
        </section>
      )}
      {/* Всё, что ждёт ответа, — одним жёлтым блоком сразу под долгами: по строке
          на каждое дело, каждая ведёт на свою страницу. */}
      {attention.length > 0 && (
        <section className="attention" aria-labelledby="attention-title">
          <h2 id="attention-title">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
              <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
            </svg>
            Требуют внимания
          </h2>
          {attention.map((a) => (
            <Link key={a.href} className={a.urgent ? "attention-row urgent" : "attention-row"} href={href(a.href)}>
              <span>{a.text}</span>
              <span aria-hidden="true">›</span>
            </Link>
          ))}
        </section>
      )}
      {/* Кнопки — под вид бизнеса (src/lib/business.ts), блоками «С клиентами» и
          «С поставщиками» (QUICK_ACTIONS.side). Тёмная — только первая, главная;
          блока без кнопок нет (у проката — только клиенты); расход — тонкой строкой. */}
      <section className="quick-actions" aria-label="Что произошло?">
        <div className={groups.length > 1 ? "action-groups" : "action-groups single"}>
          {groups.map((g) => (
            <div key={g.side} className={`action-group ${g.side}`}>
              <h3>{g.title}</h3>
              <div className="action-list">
                {g.items.map((a) => (
                  <Link key={a.id} className={a === first ? "action-tile main" : "action-tile"} href={href(a.href)}>
                    <Icon name={a.icon} />
                    <span className="action-text">
                      <strong>{a.label}</strong>
                      <small>{a.hint}</small>
                    </span>
                    <span className="action-go" aria-hidden="true">
                      ›
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
        {expense && (
          <Link className="quick-expense" href={href(expense.href)}>
            <Icon name={expense.icon} size={20} />
            <strong>Записать расход</strong>
            <small>{expense.hint.toLowerCase()}</small>
            <span aria-hidden="true">›</span>
          </Link>
        )}
      </section>
      {/* Внизу рядом: кому напомнить (деньги) и последние записи; на телефоне — друг под другом. */}
      <div className="home-bottom">
        {!staff && reminders.length > 0 && (
          <section className="panel remind-today" aria-label="Кому напомнить сегодня">
            <div className="section-title">
              <h2>Кому напомнить сегодня</h2>
              <Link className="text-button" href={href("/customers?overdue=30")}>
                Все просроченные →
              </Link>
            </div>
            <ul className="remind-list">
              {reminders.map((r) => (
                <li key={r.id}>
                  <Link className="remind-who" href={href(`/customers/${r.id}`)}>
                    <strong>{r.name}</strong>
                    <small className="muted">
                      {debtMoney(r.balance, r.currency)} · {r.reason}
                    </small>
                  </Link>
                  {r.waHref ? (
                    <a className="button whatsapp" href={r.waHref} target="_blank" rel="noreferrer">
                      Напомнить
                    </a>
                  ) : (
                    // Нет телефона — нечем напомнить: ведём вписать номер.
                    <Link className="button" href={href(`/customers/${r.id}?add_phone=1#party-data`)}>
                      Вписать телефон
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {remindersMore > 0 && (
              <p className="muted">
                И ещё {remindersMore} {plural(remindersMore, "клиент", "клиента", "клиентов")}.
              </p>
            )}
          </section>
        )}
        {recent.length > 0 && (
          <section className="panel dashboard-recent">
            <div className="section-title">
              <h2>Последние записи</h2>
              <Link className="text-button" href={href("/money")}>
                Все записи →
              </Link>
            </div>
            <ul className="recent-list">
              {recent.map((r) => (
                <li key={r.key} className={r.reversed ? "reversed-row" : ""}>
                  <span>
                    <strong>
                      {r.label}
                      {r.reversed && " · "}
                      {r.reversed && <span className="tag reversed-tag">отменена</span>}
                    </strong>
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
    </div>
  );
}
