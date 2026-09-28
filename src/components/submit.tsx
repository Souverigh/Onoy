"use client";
import { useFormStatus } from "react-dom";
export function Submit({
  children,
  disabled = false,
  pending: pendingProp = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  /** Для форм с onSubmit — useFormStatus видит только action формы. */
  pending?: boolean;
}) {
  const pending = useFormStatus().pending || pendingProp;
  return (
    <button className="button primary" disabled={pending || disabled} type="submit">
      {pending ? "Сохраняем…" : children}
    </button>
  );
}
