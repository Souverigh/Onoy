"use client";
import { useFormStatus } from "react-dom";
export function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button className="button primary" disabled={pending} type="submit">
      {pending ? "Сохраняем…" : children}
    </button>
  );
}
