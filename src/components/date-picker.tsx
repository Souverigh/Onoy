"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon";
import { bishkekNow, ruDate } from "@/lib/ru-date";

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** "ГГГГ-ММ-ДД" минус `days` дней. */
function minusDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Дата записи (задача 15): «Дата: сегодня» и иконка календаря — в ней месяц
 * сеткой. `value` — "ГГГГ-ММ-ДД" или пусто (сегодня). Выбрать можно с года
 * назад по сегодня (по Бишкеку), как проверяет сервер.
 */
export function DatePicker({
  label = "Дата",
  value,
  onChange,
  maxDaysBack = 365,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  maxDaysBack?: number;
}) {
  const [open, setOpen] = useState(false);
  // Сегодня считаем в браузере при открытии — без расхождения с сервером при отрисовке.
  const [today, setToday] = useState("");
  const [view, setView] = useState<{ y: number; m: number }>({ y: 2000, m: 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    const now = bishkekNow().slice(0, 10);
    const shown = value || now;
    setToday(now);
    setView({ y: +shown.slice(0, 4), m: +shown.slice(5, 7) - 1 });
    setOpen(true);
  }

  const min = today ? minusDays(today, maxDaysBack) : "";
  const selected = value || today;
  // Сетка месяца с понедельника.
  const first = new Date(Date.UTC(view.y, view.m, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(view.y, view.m + 1, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const monthStart = iso(view.y, view.m, 1);
  const monthEnd = iso(view.y, view.m, days);
  const canPrev = Boolean(min) && monthStart > min;
  const canNext = Boolean(today) && monthEnd < today;
  const shift = (delta: number) =>
    setView(({ y, m }) => {
      const next = m + delta;
      return { y: y + Math.floor(next / 12), m: ((next % 12) + 12) % 12 };
    });

  return (
    <div className="date-picker" ref={box}>
      <span className="date-picker-text">
        {label}: <strong>{value ? ruDate(value) : "сегодня"}</strong>
      </span>
      <button
        type="button"
        className={`date-picker-toggle${open ? " active" : ""}`}
        aria-label="Выбрать дату"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="calendar" />
      </button>
      {open && today && (
        <div className="date-picker-popover" role="dialog" aria-label="Календарь">
          <div className="date-picker-head">
            <button type="button" aria-label="Предыдущий месяц" disabled={!canPrev} onClick={() => shift(-1)}>
              ‹
            </button>
            <strong>
              {MONTHS[view.m]} {view.y}
            </strong>
            <button type="button" aria-label="Следующий месяц" disabled={!canNext} onClick={() => shift(1)}>
              ›
            </button>
          </div>
          <div className="date-picker-grid">
            {WEEKDAYS.map((w) => (
              <span key={w} className="date-picker-weekday">
                {w}
              </span>
            ))}
            {cells.map((d, i) => {
              if (d == null) return <span key={`e${i}`} />;
              const day = iso(view.y, view.m, d);
              return (
                <button
                  key={day}
                  type="button"
                  className={[day === selected ? "selected" : "", day === today ? "today" : ""].filter(Boolean).join(" ")}
                  disabled={day > today || day < min}
                  aria-pressed={day === selected}
                  onClick={() => {
                    onChange(day === today ? "" : day);
                    setOpen(false);
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>
          {value && (
            <button
              type="button"
              className="text-button date-picker-today"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            >
              Сегодня
            </button>
          )}
        </div>
      )}
    </div>
  );
}
