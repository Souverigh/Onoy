"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PERIOD_LABELS, journalHref, type JournalFilters, type JournalStatus } from "@/lib/journal-filters";

/**
 * Отборы журнала (просьба пользователя 17.10.2026, «как в 1С»): период
 * кнопками, поиск по имени, статус и кто внёс. Всё уходит в адрес страницы —
 * журнал пересчитывается на сервере, ссылку можно открыть снова.
 */
export function JournalBar({
  base,
  filters,
  statuses,
  partyLabel,
  people,
  exportHref,
}: {
  base: string;
  filters: JournalFilters;
  statuses: { value: JournalStatus; label: string }[];
  /** «Клиент» или «Поставщик» — подпись поиска. */
  partyLabel: string;
  /** Кто внёс — только у владельца, когда в магазине больше одного человека. */
  people: { id: string; label: string }[];
  exportHref: string | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q);
  const [customOpen, setCustomOpen] = useState(filters.period === "custom");
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const go = (patch: Partial<JournalFilters>) => router.push(journalHref(base, filters, patch));
  const changed =
    filters.period !== "month" || filters.q || filters.status !== "all" || filters.by || filters.sort !== "date_desc";

  return (
    <section className="journal-bar" aria-label="Отборы">
      <div className="journal-periods">
        {(Object.keys(PERIOD_LABELS) as (keyof typeof PERIOD_LABELS)[]).map((p) => (
          <Link
            key={p}
            href={journalHref(base, filters, { period: p, from: "", to: "" })}
            className={filters.period === p ? "journal-chip selected" : "journal-chip"}
            aria-current={filters.period === p ? "true" : undefined}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
        <button
          type="button"
          className={filters.period === "custom" || customOpen ? "journal-chip selected" : "journal-chip"}
          aria-expanded={customOpen}
          onClick={() => setCustomOpen((open) => !open)}
        >
          Свой период
        </button>
      </div>
      {customOpen && (
        <form
          className="journal-custom"
          onSubmit={(e) => {
            e.preventDefault();
            if (from || to) go({ period: "custom", from, to });
          }}
        >
          <label>
            С
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            по
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="button" disabled={!from && !to}>
            Показать
          </button>
        </form>
      )}
      <div className="journal-filters">
        <form
          className="journal-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            go({ q: q.trim() });
          }}
        >
          <input
            type="search"
            value={q}
            placeholder={`${partyLabel}: имя`}
            aria-label={`Найти: ${partyLabel.toLowerCase()}`}
            onChange={(e) => {
              setQ(e.target.value);
              // Очистили поле крестиком — сразу показываем всех.
              if (!e.target.value && filters.q) go({ q: "" });
            }}
          />
          <button type="submit" className="button">
            Найти
          </button>
        </form>
        <label className="journal-select">
          <span>Показать</span>
          <select value={filters.status} onChange={(e) => go({ status: e.target.value as JournalStatus })}>
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {people.length > 0 && (
          <label className="journal-select">
            <span>Кто внёс</span>
            <select value={filters.by} onChange={(e) => go({ by: e.target.value })}>
              <option value="">Все</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className="journal-actions">
          {changed && (
            <Link className="text-button" href={base}>
              Сбросить
            </Link>
          )}
          {exportHref && (
            <a className="button" href={exportHref} download>
              Скачать в Excel
            </a>
          )}
        </span>
      </div>
    </section>
  );
}
