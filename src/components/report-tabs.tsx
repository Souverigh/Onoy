"use client";

import Link from "next/link";
import { useEffect } from "react";

export type ReportTab = "day" | "month" | "dishes" | "products" | "sellers";

/** Вкладки по порядку; kitchen — только у кафе (модуль «kitchen»). */
const TABS: [ReportTab, string, string, "kitchen"?][] = [
  ["day", "/day", "День"],
  ["month", "/reports", "Месяц"],
  ["dishes", "/reports/dishes", "Блюда", "kitchen"],
  ["products", "/reports/products", "Продукты", "kitchen"],
  ["sellers", "/sellers", "Продавцы"],
];

/** Последняя открытая вкладка — пункт «Отчёты» в меню ведёт на неё. */
export const REPORT_TAB_KEY = "depter.reportTab";

/** Адрес вкладки по сохранённому значению; неизвестное или вкладка выключенной «Кухни» — «День». */
export function reportTabHref(saved: string | null, kitchen = false) {
  return TABS.find(([tab, , , module]) => tab === saved && (!module || kitchen))?.[1] ?? "/day";
}

/**
 * Раздел «Отчёты» (просьба пользователя 21.10.2026): итог дня, отчёт за месяц
 * и продажи продавцов — вкладками одного раздела, а не тремя пунктами меню.
 * Только у владельца: продавец видит лишь свои продажи.
 */
export function ReportTabs({ current, kitchen = false }: { current: ReportTab; kitchen?: boolean }) {
  useEffect(() => {
    try {
      localStorage.setItem(REPORT_TAB_KEY, current);
    } catch {
      // Приватный режим — просто откроется «День».
    }
  }, [current]);
  return (
    <nav className={kitchen ? "report-tabs wide" : "report-tabs"} aria-label="Отчёты">
      {TABS.filter(([, , , module]) => !module || kitchen).map(([tab, href, label]) => (
        <Link key={tab} href={href} className={tab === current ? "active" : ""} aria-current={tab === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
