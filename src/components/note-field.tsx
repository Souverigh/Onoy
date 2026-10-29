"use client";

import { NOTE_MAX } from "@/lib/record-note";

/** Комментарий к продаже, приходу или оплате (необязательно) — виден в истории клиента или поставщика. */
export function NoteField({
  value,
  onChange,
  placeholder = "Например: остаток привезёт завтра",
  label = "Комментарий (необязательно)",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="note-field">
      {label}
      <input
        name="note"
        maxLength={NOTE_MAX}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
