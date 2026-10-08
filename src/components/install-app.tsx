"use client";
import { useEffect, useState } from "react";

/**
 * «Установить приложение»: Depter на экране телефона со своим значком
 * (src/app/manifest.ts). Android/Chrome дают системное окно установки —
 * событие beforeinstallprompt; iPhone такого окна не даёт — показываем,
 * куда нажать в Safari. Уже установлено или браузер не умеет — ничего не видно.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Событие приходит один раз и рано, ещё до открытия нужной страницы, — ловим
// при загрузке модуля (он подключён в корневом layout через InstallCapture).
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

/** Только подключает перехват события установки — ставится в корневой layout. */
export function InstallCapture() {
  return null;
}

type Mode = "hidden" | "prompt" | "ios";

function detect(): Mode {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "hidden";
  if (deferred) return "prompt";
  // iPad с iOS 13+ притворяется Mac — отличаем по сенсорному экрану.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "hidden";
}

const DISMISS_KEY = "depter-install-dismissed";

export function InstallApp({ variant }: { variant: "banner" | "card" | "button" }) {
  const [mode, setMode] = useState<Mode>("hidden");
  const [showIos, setShowIos] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const update = () => setMode(detect());
    update();
    listeners.add(update);
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (mode === "hidden" || (variant === "banner" && dismissed)) return null;

  const install = async () => {
    if (mode === "ios") return setShowIos((v) => !v);
    const event = deferred;
    if (!event) return;
    await event.prompt();
    await event.userChoice.catch(() => null);
    // Окно установки показывается один раз на событие.
    deferred = null;
    notify();
  };
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  const button = (
    <button type="button" className={variant === "button" ? "button install-app-button" : "button primary"} onClick={install}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={22} height={22} className="install-app-icon" />
      Установить приложение
    </button>
  );
  const iosHint = showIos && (
    <p className="install-app-ios" role="status">
      В Safari нажмите «Поделиться» (квадрат со стрелкой вверх) внизу экрана, затем «На экран „Домой“». Значок
      Depter появится рядом с другими приложениями.
    </p>
  );

  if (variant === "button")
    return (
      <div className="install-app">
        {button}
        {iosHint}
      </div>
    );

  if (variant === "card")
    return (
      <section className="panel settings-card" id="app">
        <header>
          <h2>Приложение на телефоне</h2>
          <p className="muted">Значок Depter на экране телефона - открывается сразу, без браузера и адресной строки.</p>
        </header>
        <div className="install-app">
          {button}
          {iosHint}
        </div>
      </section>
    );

  return (
    <div className="install-banner" role="region" aria-label="Установить приложение">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={40} height={40} className="install-banner-icon" />
      <div className="install-banner-text">
        <strong>Depter на экране телефона</strong>
        <span className="muted">Открывайте одним нажатием, как обычное приложение.</span>
        {iosHint}
      </div>
      <div className="install-banner-actions">
        <button type="button" className="button primary" onClick={install}>
          Установить
        </button>
        <button type="button" className="text-button" onClick={dismiss} aria-label="Скрыть">
          Не сейчас
        </button>
      </div>
    </div>
  );
}
