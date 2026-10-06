"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * «Подтверждено · Вернуть» на несколько секунд (задача 19). `onUndo` —
 * серверное действие; после него страница обновляется.
 */
export function UndoToast({
  text,
  seconds = 5,
  onUndo,
  clearHref,
}: {
  text: string;
  seconds?: number;
  onUndo: () => Promise<{ ok: boolean }>;
  /** Адрес без параметра «вернуть» — чтобы после обновления окно не появилось снова. */
  clearHref: string;
}) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  const [state, setState] = useState<"idle" | "busy" | "failed" | "done">("idle");
  useEffect(() => {
    if (state !== "idle") return;
    if (left <= 0) {
      router.replace(clearHref, { scroll: false });
      return;
    }
    const timer = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [left, state, router, clearHref]);
  if (state === "done" || (left <= 0 && state === "idle")) return null;
  return (
    <div className="undo-toast" role="status">
      <span>{state === "failed" ? "Вернуть уже нельзя" : text}</span>
      {state !== "failed" && (
        <button
          type="button"
          disabled={state === "busy"}
          onClick={async () => {
            setState("busy");
            const res = await onUndo().catch(() => ({ ok: false }));
            if (!res.ok) {
              setState("failed");
              return;
            }
            setState("done");
            router.replace(`${clearHref}${clearHref.includes("?") ? "&" : "?"}done=undone`, { scroll: false });
          }}
        >
          Вернуть ({left})
        </button>
      )}
    </div>
  );
}
