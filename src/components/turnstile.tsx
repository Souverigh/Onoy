"use client";
import { useEffect, useRef, useState } from "react";

/** Скрипт Cloudflare Turnstile — проверка «я не робот» (см. src/lib/captcha.ts). */
const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

type TurnstileApi = {
  render: (parent: HTMLElement, options: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Скрипт грузим один раз на страницу, даже если форм с проверкой несколько. */
let loading: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Проверка «я не робот» внутри формы входа, регистрации или письма. Обычно
 * невидима (Cloudflare проверяет сам); галочку показывает, только если
 * засомневался. Ответ — скрытое поле формы. Нажали «Отправить» раньше ответа —
 * форма ждёт его и уходит сама. Ответ одноразовый: после отправки берём новый
 * (форма могла вернуться с ошибкой).
 */
export function Turnstile() {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const form = box.current?.closest("form");
    if (!SITE_KEY || !form) return;
    let id: string | undefined;
    let token = "";
    let broken = false;
    let cancelled = false;
    // Отправка, отложенная до ответа проверки (submitter — нажатая кнопка).
    let waiting: { submitter: HTMLElement | null } | null = null;
    const resume = () => {
      if (!waiting) return;
      const { submitter } = waiting;
      waiting = null;
      form.requestSubmit(submitter);
    };
    const onSubmit = (event: SubmitEvent) => {
      if (!token && !broken) {
        event.preventDefault();
        waiting = { submitter: event.submitter };
        return;
      }
      token = "";
      // Форма уже собрана — сбрасываем после неё.
      setTimeout(() => id && window.turnstile?.reset(id), 0);
    };
    const fail = () => {
      broken = true;
      if (!cancelled) setFailed(true);
      // Без ответа Supabase откажет, и форма покажет, что проверка не прошла.
      resume();
    };
    form.addEventListener("submit", onSubmit);
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: SITE_KEY,
          appearance: "interaction-only",
          language: "ru",
          callback: (value: string) => {
            token = value;
            broken = false;
            setFailed(false);
            resume();
          },
          "expired-callback": () => {
            token = "";
          },
          "error-callback": fail,
        });
      })
      .catch(fail);
    return () => {
      cancelled = true;
      form.removeEventListener("submit", onSubmit);
      if (id) window.turnstile?.remove(id);
    };
  }, []);

  if (!SITE_KEY) return null;
  return (
    <>
      <div ref={box} className="turnstile" />
      {failed && (
        <p className="form-error" role="alert">
          Проверка «я не робот» не загрузилась. Обновите страницу.
        </p>
      )}
    </>
  );
}
