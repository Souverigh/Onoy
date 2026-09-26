"use client";

import Link from "next/link";
import { useState } from "react";
import {
  importOpenings,
  recognizeNotebookPhotos,
  type OpeningResult,
} from "@/app/(workspace)/import/actions";
import { bestMatches, similarity } from "@/lib/match";
import { money } from "@/lib/format";
import { MULTI_PAGE_MAX_SIDE, shrinkImage } from "@/lib/shrink-image";
import { DOCUMENT_ACCEPT, MAX_PAGES, MAX_UPLOAD_BYTES } from "@/lib/pages";

export type ImportParty = {
  id: string;
  name: string;
  aliases: string[];
  balance: string;
  transferred: boolean;
};

type Row = {
  key: string;
  name: string;
  phone: string;
  amount: string;
  /** "" — новый контрагент с этим именем. */
  partyId: string;
  doubt: boolean;
  result?: OpeningResult;
};

const ERRORS: Record<string, string> = {
  exists: "Долг этого контрагента уже перенесён. Чтобы исправить — отмените прежний в его карточке.",
  amount: "Проверьте сумму: число, минус — аванс.",
  invalid: "Обновите страницу и попробуйте снова.",
  save: "Не удалось сохранить. Попробуйте ещё раз.",
};

function rowsWord(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "строка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "строки";
  return "строк";
}

function amountValue(raw: string): number | null {
  const s = raw.trim().replace(/[\s ']/g, "").replace(/^[−–]/, "-").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const value = Number(s);
  return value === 0 ? null : value;
}

export function NotebookImport({
  kind,
  parties,
}: {
  kind: "customers" | "suppliers";
  parties: ImportParty[];
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [recognizing, setRecognizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const byId = new Map(parties.map((p) => [p.id, p]));
  const who = kind === "customers" ? "клиент" : "поставщик";

  /** Тот же человек уже в справочнике — берём его (имя совпало или почти совпало). */
  function guessParty(name: string): string {
    const best = bestMatches(name, parties, 1, 0.85)[0];
    return best ? best.candidate.id : "";
  }

  function newRow(name = "", phone = "", amount = "", doubt = false): Row {
    return { key: crypto.randomUUID(), name, phone, amount, partyId: name ? guessParty(name) : "", doubt };
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function recognize(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, MAX_PAGES);
    e.target.value = "";
    if (!files.length) return;
    setRecognizing(true);
    setNote(null);
    setWarnings([]);
    try {
      const shrunk = await Promise.all(
        files.map((file) => shrinkImage(file, files.length > 1 ? MULTI_PAGE_MAX_SIDE : undefined)),
      );
      if (shrunk.reduce((size, file) => size + file.size, 0) > MAX_UPLOAD_BYTES) {
        setNote("Файлы слишком большие (больше 4 МБ вместе) — выберите меньше страниц за раз.");
        return;
      }
      const fd = new FormData();
      shrunk.forEach((file) => fd.append("photo", file));
      const res = await recognizeNotebookPhotos(fd);
      if (!res.ok) {
        setNote(
          res.error === "no_provider"
            ? "Распознавание сейчас недоступно — впишите строки вручную."
            : "Не удалось прочитать страницы. Попробуйте фото получше или впишите вручную.",
        );
        return;
      }
      if (!res.rows.length) setNote("На фото не нашлось строк «имя — сумма».");
      setWarnings(res.warnings);
      setRows((current) => [
        ...current.filter((row) => row.name || row.amount),
        ...res.rows.map((r) =>
          newRow(r.name, r.phone, String(r.amount), r.confidence < 0.8),
        ),
      ]);
    } catch (err) {
      console.error("recognizeNotebookPhotos failed", err);
      setNote("Не удалось прочитать страницы. Попробуйте ещё раз или впишите вручную.");
    } finally {
      setRecognizing(false);
    }
  }

  const pending = rows.filter((row) => !row.result?.ok);
  const ready = pending.filter((row) => {
    const party = row.partyId ? byId.get(row.partyId) : null;
    return (row.partyId || row.name.trim()) && amountValue(row.amount) !== null && !party?.transferred;
  });
  const total = ready.reduce((sum, row) => sum + (amountValue(row.amount) ?? 0), 0);
  const saved = rows.filter((row) => row.result?.ok);

  async function save() {
    if (!ready.length) return;
    setSaving(true);
    setNote(null);
    try {
      const results = await importOpenings(
        kind,
        ready.map((row) => ({
          key: row.key,
          partyId: row.partyId || null,
          name: row.name.trim(),
          phone: row.phone.trim(),
          amount: row.amount,
        })),
      );
      const byKey = new Map(results.map((r) => [r.key, r]));
      setRows((current) =>
        current.map((row) => (byKey.has(row.key) ? { ...row, result: byKey.get(row.key) } : row)),
      );
      const failed = results.filter((r) => !r.ok).length;
      setNote(
        failed
          ? `Сохранено: ${results.length - failed}. Не сохранено: ${failed} — см. строки ниже.`
          : `Сохранено: ${results.length}. Долги уже в балансе.`,
      );
    } catch (err) {
      console.error("importOpenings failed", err);
      setNote("Не удалось сохранить. Проверьте интернет и попробуйте ещё раз — повтор ничего не задвоит.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel notebook-import">
      <div className="notebook-actions">
        <label className="button primary">
          {recognizing ? "Читаем страницы…" : "Сфотографировать страницы тетради"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={recognizing}
            onChange={recognize}
          />
        </label>
        <label className="button">
          Выбрать фото или PDF
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            className="sr-only"
            disabled={recognizing}
            onChange={recognize}
          />
        </label>
        <button type="button" className="button" onClick={() => setRows((r) => [...r, newRow()])}>
          + Добавить строку вручную
        </button>
      </div>
      <p className="operation-hint">
        Сумма — сколько {kind === "customers" ? "клиент должен вам" : "вы должны поставщику"} на
        сегодня. Со знаком минус — аванс. До {MAX_PAGES} страниц за раз; можно фотографировать
        частями.
      </p>
      {note && <p className="notice">{note}</p>}
      {warnings.length > 0 && (
        <div className="photo-check-mismatch">
          Проверьте внимательно:
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length > 0 && (
        <ol className="notebook-rows">
          {rows.map((row) => {
            const party = row.partyId ? byId.get(row.partyId) : undefined;
            const matches = row.name.trim()
              ? bestMatches(row.name, parties, 4, 0.45).filter((m) => m.candidate.id !== row.partyId)
              : [];
            const amount = amountValue(row.amount);
            const done = row.result?.ok;
            return (
              <li
                key={row.key}
                className={`notebook-row${done ? " done" : ""}${row.doubt && !done ? " doubt" : ""}`}
              >
                <div className="notebook-row-fields">
                  <label>
                    Имя
                    <input
                      value={row.name}
                      maxLength={160}
                      disabled={done}
                      onChange={(e) => {
                        const name = e.target.value;
                        const current = row.partyId ? byId.get(row.partyId) : undefined;
                        // Имя поменяли и оно больше не про выбранного — ищем заново.
                        const keep = current && similarity(name, current.name) >= 0.85;
                        update(row.key, { name, partyId: keep ? row.partyId : guessParty(name) });
                      }}
                    />
                  </label>
                  <label>
                    Сумма, сом
                    <input
                      value={row.amount}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={done}
                      onChange={(e) => update(row.key, { amount: e.target.value })}
                    />
                  </label>
                  {!row.partyId && (
                    <label>
                      Телефон
                      <input
                        value={row.phone}
                        maxLength={40}
                        inputMode="tel"
                        placeholder="Необязательно"
                        disabled={done}
                        onChange={(e) => update(row.key, { phone: e.target.value })}
                      />
                    </label>
                  )}
                </div>
                <div className="notebook-row-meta">
                  {done ? (
                    <span className="photo-check-ok">
                      ✓ Сохранено ·{" "}
                      <Link href={`/${kind}/${row.result!.partyId}`}>открыть карточку</Link>
                    </span>
                  ) : (
                    <>
                      <span className="muted">
                        {party
                          ? `Есть в справочнике: ${party.name} (сейчас ${money(party.balance)})`
                          : row.name.trim()
                            ? `Новый ${who}: «${row.name.trim()}»`
                            : "Впишите имя"}
                        {amount !== null && amount < 0 && " · аванс"}
                        {row.doubt && " · плохо читается, проверьте"}
                      </span>
                      {party?.transferred && (
                        <span className="form-error">Долг уже перенесён — строку пропустим.</span>
                      )}
                      {row.result && !row.result.ok && (
                        <span className="form-error">{ERRORS[row.result.error ?? "save"]}</span>
                      )}
                      <span className="notebook-row-links">
                        {party && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => update(row.key, { partyId: "" })}
                          >
                            Это другой человек
                          </button>
                        )}
                        {matches.map((m) => (
                          <button
                            key={m.candidate.id}
                            type="button"
                            className="text-button"
                            onClick={() => update(row.key, { partyId: m.candidate.id })}
                          >
                            Это {m.candidate.name}?
                          </button>
                        ))}
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => setRows((r) => r.filter((x) => x.key !== row.key))}
                        >
                          Убрать строку
                        </button>
                      </span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {pending.length > 0 && (
        <div className="notebook-save">
          <span>
            К переносу: {ready.length} {rowsWord(ready.length)} на{" "}
            <strong>{money(total)}</strong>
          </span>
          <button
            type="button"
            className="button primary"
            disabled={saving || recognizing || ready.length === 0}
            onClick={save}
          >
            {saving ? "Сохраняем…" : "Сохранить долги"}
          </button>
        </div>
      )}
      {saved.length > 0 && pending.length === 0 && (
        <p className="muted">
          Все строки перенесены.{" "}
          <Link href={`/${kind}`}>{kind === "customers" ? "К клиентам" : "К поставщикам"} →</Link>
        </p>
      )}
    </section>
  );
}
