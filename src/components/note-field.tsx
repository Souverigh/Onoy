"use client";

import { NOTE_MAX } from "@/lib/record-note";

/** Комментарий к продаже или приходу (необязательно) — виден в истории клиента или поставщика. */
export function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="note-field">
      Комментарий (необязательно)
      <input
        name="note"
        maxLength={NOTE_MAX}
        autoComplete="off"
        placeholder="Например: остаток привезёт завтра"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
