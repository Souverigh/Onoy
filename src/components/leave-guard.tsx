"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Уход из формы, где уже выбрано фото, но запись не сделана (задача 14):
 * «Фото не сохранено. Уйти?» окном Depter — и для ссылок внутри Depter, и
 * (окном браузера — другого там нет) при закрытии вкладки.
 */
export function LeaveGuard({ active, title = "Фото не сохранено. Уйти?", text }: { active: boolean; title?: string; text?: string }) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [active]);
  return (
    <ConfirmDialog
      open={target !== null}
      title={title}
      text={text ?? "Запись не сделана — фото и сумма пропадут."}
      danger
      confirmLabel="Да, уйти"
      cancelLabel="Нет, остаться"
      onCancel={() => setTarget(null)}
      onConfirm={() => {
        const href = target;
        setTarget(null);
        if (href) window.location.assign(href);
      }}
    />
  );
}
