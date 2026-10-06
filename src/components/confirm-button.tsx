"use client";

import { useRef, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Кнопка отправки формы с подтверждением окном Depter (ТЗ §7: опасные
 * действия; задача 30 — не окно браузера). Удаление — «Вернуть будет нельзя».
 */
export function ConfirmButton({
  message,
  text,
  confirmLabel,
  cancelLabel,
  danger = true,
  className,
  name,
  value,
  children,
}: {
  message: string;
  text?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  className?: string;
  name?: string;
  value?: string;
  children: React.ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={button}
        type="submit"
        className={className}
        name={name}
        value={value}
        onClick={(e) => {
          if (confirmed.current) {
            confirmed.current = false;
            return;
          }
          e.preventDefault();
          setOpen(true);
        }}
      >
        {children}
      </button>
      <ConfirmDialog
        open={open}
        title={message}
        text={text}
        danger={danger}
        confirmLabel={confirmLabel ?? (danger ? "Да, удалить" : "Да")}
        cancelLabel={cancelLabel ?? (danger ? "Нет, оставить" : "Нет")}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          confirmed.current = true;
          button.current?.click();
        }}
      />
    </>
  );
}
