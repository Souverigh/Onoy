"use client";

import { useEffect, useRef } from "react";

/**
 * Окно подтверждения Depter вместо окна браузера «OK / Отмена» (задача 30).
 * Опасное действие — красная кнопка «Да, удалить» и обычная «Нет, оставить».
 */
export function ConfirmDialog({
  open,
  title,
  text,
  confirmLabel = "Да",
  cancelLabel = "Нет",
  danger = false,
  onConfirm,
  onCancel,
  onDismiss,
}: {
  open: boolean;
  title: string;
  text?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Esc или нажатие мимо окна; по умолчанию — как «Нет». */
  onDismiss?: () => void;
}) {
  const dismiss = onDismiss ?? onCancel;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="confirm-dialog"
      aria-labelledby="confirm-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        // Нажатие на затемнение вокруг окна — закрыть.
        if (e.target === ref.current) dismiss();
      }}
    >
      <div className="confirm-dialog-body">
        <h2 id="confirm-dialog-title">{title}</h2>
        {text && <div className="confirm-dialog-text">{text}</div>}
        <div className="confirm-dialog-actions">
          <button type="button" className={`button ${danger ? "danger-solid" : "primary"}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="button" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
