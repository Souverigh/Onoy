"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DatePicker } from "./date-picker";
import { Icon } from "./icon";
import { PERIOD_LABELS, journalHref, type JournalFilters, type JournalSort, type JournalStatus } from "@/lib/journal-filters";
import { ruDate } from "@/lib/ru-date";

const SORT_LABELS: Record<JournalSort, string> = {
  date_desc: "Сначала новые",
  date_asc: "Сначала старые",
  sum_desc: "Сначала дорогие",
  sum_asc: "Сначала дешёвые",
};

/**
 * Отборы журнала как в обычных приложениях (просьба пользователя 17.10.2026):
 * одна строка — поиск, период «Месяц ▾» и «Фильтры» с числом включённых;
 * включённые отборы — метками с ×. Всё уходит в адрес страницы — журнал
 * пересчитывается на сервере, ссылку можно открыть снова.
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
  const [open, setOpen] = useState<"period" | "filters" | null>(null);
  const [customOpen, setCustomOpen] = useState(filters.period === "custom");
  const [from, setFrom] = useState(filters.from);
  const [to, setTo] = useState(filters.to);
  const box = useRef<HTMLDivElement>(null);
  const go = (patch: Partial<JournalFilters>) => {
    setOpen(null);
    router.push(journalHref(base, filters, patch));
  };

  // Закрыть выпадающее окно: нажатие мимо или Esc.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const periodText =
    filters.period === "custom"
      ? `${filters.from ? ruDate(filters.from) : "…"} – ${filters.to ? ruDate(filters.to) : "…"}`
      : PERIOD_LABELS[filters.period];
  const statusLabel = statuses.find((s) => s.value === filters.status)?.label;
  const personLabel = people.find((p) => p.id === filters.by)?.label;
  const activeCount = (filters.status !== "all" ? 1 : 0) + (filters.by ? 1 : 0) + (filters.sort !== "date_desc" ? 1 : 0);
  type Chip = { key: string; text: string; patch: Partial<JournalFilters> };
  const chips = ([
    filters.q ? { key: "q", text: `«${filters.q}»`, patch: { q: "" } } : null,
    filters.status !== "all" ? { key: "status", text: statusLabel ?? "", patch: { status: "all" as const } } : null,
    filters.by ? { key: "by", text: `Внёс: ${personLabel ?? "…"}`, patch: { by: "" } } : null,
    filters.sort !== "date_desc" ? { key: "sort", text: SORT_LABELS[filters.sort], patch: { sort: "date_desc" as const } } : null,
  ] as (Chip | null)[]).filter((c): c is Chip => Boolean(c));

  return (
    <section className="journal-bar" aria-label="Отборы" ref={box}>
      <div className="journal-toolbar">
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
            enterKeyHint="search"
            placeholder={`Найти: ${partyLabel.toLowerCase()}`}
            aria-label={`Найти: ${partyLabel.toLowerCase()}`}
            onChange={(e) => {
              setQ(e.target.value);
              // Очистили поле крестиком — сразу показываем всех.
              if (!e.target.value && filters.q) go({ q: "" });
            }}
          />
        </form>

        <div className="journal-drop">
          <button
            type="button"
            className={`journal-drop-button${open === "period" ? " active" : ""}`}
            aria-expanded={open === "period"}
            onClick={() => setOpen(open === "period" ? null : "period")}
          >
            <Icon name="calendar" />
            <span>{periodText}</span>
            <span aria-hidden="true">▾</span>
          </button>
          {open === "period" && (
            <div className="journal-panel" role="dialog" aria-label="Период">
              <ul className="journal-options">
                {(Object.keys(PERIOD_LABELS) as (keyof typeof PERIOD_LABELS)[]).map((p) => (
                  <li key={p}>
                    <button
                      type="button"
                      className={filters.period === p && !customOpen ? "selected" : ""}
                      aria-pressed={filters.period === p && !customOpen}
                      onClick={() => {
                        setCustomOpen(false);
                        go({ period: p, from: "", to: "" });
                      }}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  </li>
                ))}
                <li>
                  <button
                    type="button"
                    className={customOpen ? "selected" : ""}
                    aria-pressed={customOpen}
                    onClick={() => setCustomOpen(true)}
                  >
                    Свой период…
                  </button>
                </li>
              </ul>
              {customOpen && (
                <div className="journal-custom">
                  <DatePicker variant="field" label="С" value={from} onChange={setFrom} emptyLabel="Начало" maxDaysBack={3650} clearable />
                  <DatePicker variant="field" label="По" value={to} onChange={setTo} emptyLabel="Сегодня" maxDaysBack={3650} clearable />
                  <button
                    type="button"
                    className="button primary"
                    disabled={!from && !to}
                    onClick={() => go({ period: "custom", from, to })}
                  >
                    Показать
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="journal-drop">
          <button
            type="button"
            className={`journal-drop-button${open === "filters" ? " active" : ""}`}
            aria-expanded={open === "filters"}
            onClick={() => setOpen(open === "filters" ? null : "filters")}
          >
            <span>Фильтры</span>
            {activeCount > 0 && <span className="journal-count">{activeCount}</span>}
            <span aria-hidden="true">▾</span>
          </button>
          {open === "filters" && (
            <div className="journal-panel journal-panel-right" role="dialog" aria-label="Фильтры">
              <p className="journal-panel-title">Показать</p>
              <div className="journal-segments">
                {statuses.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    className={filters.status === s.value ? "selected" : ""}
                    aria-pressed={filters.status === s.value}
                    onClick={() => go({ status: s.value })}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              {people.length > 0 && (
                <>
                  <p className="journal-panel-title">Кто внёс</p>
                  <div className="journal-segments">
                    {[{ id: "", label: "Все" }, ...people].map((p) => (
                      <button
                        key={p.id || "all"}
                        type="button"
                        className={filters.by === p.id ? "selected" : ""}
                        aria-pressed={filters.by === p.id}
                        onClick={() => go({ by: p.id })}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <p className="journal-panel-title">Сортировка</p>
              <div className="journal-segments">
                {(Object.keys(SORT_LABELS) as JournalSort[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={filters.sort === s ? "selected" : ""}
                    aria-pressed={filters.sort === s}
                    onClick={() => go({ sort: s })}
                  >
                    {SORT_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {exportHref && (
          <a className="journal-drop-button journal-export" href={exportHref} download title="Скачать в Excel">
            <span aria-hidden="true">⤓</span>
            <span>Excel</span>
          </a>
        )}
      </div>

      {chips.length > 0 && (
        <div className="journal-chips">
          {chips.map((c) => (
            <button key={c.key} type="button" className="journal-chip" onClick={() => go(c.patch)} aria-label={`Убрать отбор: ${c.text}`}>
              {c.text} <span aria-hidden="true">×</span>
            </button>
          ))}
          {chips.length > 1 && (
            <Link className="text-button" href={journalHref(base, filters, { q: "", status: "all", by: "", sort: "date_desc" })}>
              Сбросить всё
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
