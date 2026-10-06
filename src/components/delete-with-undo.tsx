"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./confirm-dialog";

const UNDO_MS = 10_000;

/**
 * «Удалить» (задача 29): окно Depter «Удалить …? Вернуть будет нельзя.» с
 * красной «Да, удалить» и обычной «Нет, оставить»; потом 10 секунд
 * «Удалено · Вернуть» — удаляем только после них (или когда уходят со
 * страницы). `hide` — id элемента, который прячем сразу.
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
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(false);

  const body = () => {
    const form = new FormData();
    form.set("what", what);
    form.set("id", id);
    return form;
  };
  const setHidden = (hidden: boolean) => {
    const el = hide ? document.getElementById(hide) : null;
    if (el) el.hidden = hidden;
  };

  async function commit() {
    if (sent.current) return;
    sent.current = true;
    try {
      const res = await fetch("/delete", { method: "POST", body: body(), keepalive: true });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        sent.current = false;
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
      if (afterHref) router.push(afterHref);
      else router.refresh();
    } catch {
      sent.current = false;
      setPending(false);
      setHidden(false);
      setError("Нет связи — не удалено. Попробуйте ещё раз.");
    }
  }

  useEffect(() => {
    if (!pending) return;
    // Ушли со страницы раньше 10 секунд — удаляем сразу.
    const onHide = () => {
      if (sent.current) return;
      sent.current = true;
      navigator.sendBeacon("/delete", body());
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- body зависит только от what/id
  }, [pending]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <>
      <button type="button" className={className} onClick={() => setAsking(true)} disabled={pending}>
        {label}
      </button>
      {error && (
        <span className="form-error" role="alert">
          {error}
        </span>
      )}
      <ConfirmDialog
        open={asking}
        title={title}
        text="Вернуть будет нельзя."
        danger
        confirmLabel="Да, удалить"
        cancelLabel="Нет, оставить"
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          setError(null);
          setPending(true);
          setHidden(true);
          timer.current = setTimeout(() => void commit(), UNDO_MS);
        }}
      />
      {pending && (
        <div className="undo-toast" role="status">
          <span>Удалено</span>
          <button
            type="button"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current);
              timer.current = null;
              setPending(false);
              setHidden(false);
            }}
          >
            Вернуть
          </button>
        </div>
      )}
    </>
  );
}
