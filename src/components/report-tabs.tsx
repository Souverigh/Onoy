"use client";

import Link from "next/link";
import { useEffect } from "react";

export type ReportTab = "day" | "month" | "sellers";

const TABS: [ReportTab, string, string][] = [
  ["day", "/day", "День"],
  ["month", "/reports", "Месяц"],
  ["sellers", "/sellers", "Продавцы"],
];

/** Последняя открытая вкладка — пункт «Отчёты» в меню ведёт на неё. */
export const REPORT_TAB_KEY = "depter.reportTab";

/** Адрес вкладки по сохранённому значению; неизвестное — «День». */
export function reportTabHref(saved: string | null) {
  return TABS.find(([tab]) => tab === saved)?.[1] ?? "/day";
}

/**
 * Раздел «Отчёты» (просьба пользователя 21.10.2026): итог дня, отчёт за месяц
 * и продажи продавцов — вкладками одного раздела, а не тремя пунктами меню.
 * Только у владельца: продавец видит лишь свои продажи.
 */
export function ReportTabs({ current }: { current: ReportTab }) {
  useEffect(() => {
    try {
      localStorage.setItem(REPORT_TAB_KEY, current);
    } catch {
      // Приватный режим — просто откроется «День».
    }
  }, [current]);
  return (
    <nav className="report-tabs" aria-label="Отчёты">
      {TABS.map(([tab, href, label]) => (
        <Link key={tab} href={href} className={tab === current ? "active" : ""} aria-current={tab === current ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
