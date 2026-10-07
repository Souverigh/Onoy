"use client";

import { useEffect, useState } from "react";
import { isoDate, isoTime, maskDate, maskTime, ruDate } from "@/lib/ru-date";
import { InfoTip } from "./info-tip";

export { bishkekNow } from "@/lib/ru-date";

/**
 * Поле даты «дд.мм.гггг» (и времени «чч:мм») в формате КР. Встроенный
 * <input type="date"> показывает формат языка браузера (mm/dd/yyyy в
 * английском Chrome), поэтому поле своё: точки и двоеточие подставляются
 * сами. `value` задаётся снаружи (сегодня, дата с чека) — поле его
 * показывает; введённое уходит в `onChange`: "ГГГГ-ММ-ДД[Tчч:мм]" или null,
 * пока дата введена не до конца или такой даты нет.
 */
export function RuDateInput({
  label,
  value,
  onChange,
  withTime = false,
  hint,
  tip,
}: {
  label: string;
  value: string;
  onChange: (value: string | null) => void;
  withTime?: boolean;
  hint?: React.ReactNode;
  /** Пояснение под значком «!» рядом с подписью — вместо строки под полем. */
  tip?: React.ReactNode;
}) {
  const [dateText, setDateText] = useState(ruDate(value));
  const [timeText, setTimeText] = useState(value.slice(11, 16));
  useEffect(() => {
    setDateText(ruDate(value));
    setTimeText(value.slice(11, 16));
  }, [value]);

  function emit(nextDate: string, nextTime: string) {
    const d = isoDate(nextDate);
    const t = withTime ? isoTime(nextTime) : "";
    onChange(d && t !== null ? (withTime ? `${d}T${t}` : d) : null);
  }
  const invalid = dateText.length === 10 && !isoDate(dateText);

  return (
    <div className="ru-date-field">
      {tip ? (
        <span className="label-with-tip">
          {label}
          <InfoTip>{tip}</InfoTip>
        </span>
      ) : (
        <span>{label}</span>
      )}
      <div className="ru-date-inputs">
        <input
          inputMode="numeric"
          autoComplete="off"
          placeholder="дд.мм.гггг"
          aria-label={`${label}: дата`}
          value={dateText}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            const next = maskDate(e.target.value);
            setDateText(next);
            emit(next, timeText);
          }}
        />
        {withTime && (
          <input
            className="ru-time-input"
            inputMode="numeric"
            autoComplete="off"
            placeholder="чч:мм"
            aria-label={`${label}: время`}
            value={timeText}
            onChange={(e) => {
              const next = maskTime(e.target.value);
              setTimeText(next);
              emit(dateText, next);
            }}
          />
        )}
      </div>
      {invalid ? <small className="form-error-inline">Такой даты нет — проверьте число и месяц.</small> : hint}
    </div>
  );
}
