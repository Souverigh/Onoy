"use client";
import { useFormStatus } from "react-dom";
export function Submit({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" disabled={pending || disabled} type="submit">
      {pending ? "Сохраняем…" : children}
    </button>
  );
}
