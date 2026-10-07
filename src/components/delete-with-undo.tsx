"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "./confirm-dialog";

const UNDO_MS = 10_000;

/**
 * «Удалить» (задача 29): окно Depter «Удалить …?» с красной «Да, удалить» и
 * обычной «Нет, оставить»; удаляем сразу после «Да». Фото удаляется мягко
 * (document_soft_delete) — 10 секунд «Удалено · Вернуть»; строки, клиенты и
 * поставщики — насовсем. `hide` — id элемента, который прячем сразу.
 */
export function DeleteWithUndo({
  what,
  id,
  title,
  label = "Удалить",
  className = "button danger-outline",
  hide,
  afterHref,
}: {
  what: "document" | "line" | "customers" | "suppliers";
  id: string;
  title: string;
  label?: string;
  className?: string;
  hide?: string;
  /** Куда уйти после удаления; нет — обновить страницу. */
  afterHref?: string;
}) {
  const router = useRouter();
  const undoable = what === "document";
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  // Удалено, можно «Вернуть» (только фото).
  const [undo, setUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const setHidden = (hidden: boolean) => {
    const el = hide ? document.getElementById(hide) : null;
    if (el) el.hidden = hidden;
  };
  const send = (restore: boolean) => {
    const form = new FormData();
    form.set("what", what);
    form.set("id", id);
    if (restore) form.set("restore", "1");
    return fetch("/delete", { method: "POST", body: form });
  };
  const done = () => {
    if (afterHref) router.push(afterHref);
    else router.refresh();
  };

  async function commit() {
    try {
      const res = await send(false);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setPending(false);
        setHidden(false);
        setError(
          data.error === "in_use"
            ? "Удалить нельзя: уже есть записи. Можно убрать в архив."
            : data.error === "owner_only"
              ? "Старое фото может удалить только владелец."
              : "Не удалось удалить. Попробуйте ещё раз.",
        );
        return;
      }
      setPending(false);
      if (!undoable) return done();
      // Уже удалено (и после обновления страницы не появится); 10 секунд — «Вернуть».
      setUndo(true);
      timer.current = setTimeout(() => {
        setUndo(false);
        done();
      }, UNDO_MS);
    } catch {
      setPending(false);
      setHidden(false);
      setError("Нет связи - не удалено. Попробуйте ещё раз.");
    }
  }

  async function restore() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setUndo(false);
    try {
      const res = await send(true);
      if (!res.ok) throw new Error("restore");
      setHidden(false);
      router.refresh();
    } catch {
      setError("Не удалось вернуть фото.");
      done();
    }
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)} disabled={pending || undo}>
        {pending ? "Удаляем…" : label}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={asking}
        title={title}
        text={undoable ? "Вернуть можно будет 10 секунд." : "Вернуть будет нельзя."}
        danger
        confirmLabel="Да, удалить"
        cancelLabel="Нет, оставить"
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          setError(null);
          setPending(true);
          setHidden(true);
          void commit();
        }}
      />
      {/* В body: строка с кнопкой уже спрятана (hide), тост в ней не был бы виден. */}
      {undo &&
        createPortal(
          <div className="undo-toast" role="status">
            <span>Удалено</span>
            <button type="button" onClick={() => void restore()}>
              Вернуть
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
