"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** Дольше этого не держим отклик — вдруг переход или действие молча не случились. */
const SAFETY_MS = 15000;

/**
 * Отклик на нажатие для всего приложения, без правок каждой ссылки: полоска
 * загрузки сверху и `data-pending` на нажатой ссылке / кнопке отправки (CSS
 * пульсирует и не даёт нажать второй раз). Снимается, когда сменился адрес;
 * у формы — ещё и когда страница перерисовалась (действие без перехода,
 * ошибка). Кнопки `Submit` показывают «Сохраняем…» сами — их не трогаем.
 */
export function NavFeedback() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [active, setActive] = useState(false);
  const marked = useRef<Element | null>(null);
  const observer = useRef<MutationObserver | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const stop = useRef(() => {
    marked.current?.removeAttribute("data-pending");
    marked.current = null;
    observer.current?.disconnect();
    observer.current = null;
    window.clearTimeout(timer.current);
    setActive(false);
  });

  useEffect(() => {
    stop.current();
  }, [pathname, search]);

  useEffect(() => {
    const start = (el: Element, watchPage: boolean) => {
      stop.current();
      el.setAttribute("data-pending", "");
      marked.current = el;
      setActive(true);
      timer.current = window.setTimeout(() => stop.current(), SAFETY_MS);
      if (watchPage) {
        // Ответ действия меняет разметку страницы — значит, дождались.
        const mo = new MutationObserver((records) => {
          if (records.some((r) => !(r.target instanceof Element && r.target.closest(".nav-progress"))))
            stop.current();
        });
        mo.observe(document.body, { childList: true, subtree: true, characterData: true });
        observer.current = mo;
      }
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.hasAttribute("download") || (a.target && a.target !== "_self")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      // Только якорь на той же странице — перехода нет.
      if (url.pathname === location.pathname && url.search === location.search) return;
      // Файлы (PDF, Excel) браузер скачивает сам, адрес не меняется.
      if (/\/(pdf|export)(\/|$)|\/invoice\//.test(url.pathname)) return;
      start(a, false);
    };

    const onSubmit = (e: SubmitEvent) => {
      const button = e.submitter;
      if (!button || button.hasAttribute("data-own-pending")) return;
      start(button, true);
    };

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
    };
  }, []);

  return <div className={`nav-progress${active ? " is-active" : ""}`} aria-hidden="true" />;
}
