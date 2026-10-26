"use client";

import { useEffect, useState } from "react";
import { removePushSubscription, savePushSubscription, sendTestPush } from "@/app/(workspace)/settings/push-actions";

type State = "loading" | "unsupported" | "ios-install" | "denied" | "off" | "on";

/** Публичный ключ VAPID «BCu…» → байты для pushManager.subscribe. */
function keyBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent);
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/");
  return registration ? registration.pushManager.getSubscription() : null;
}

/**
 * Уведомления на этом телефоне (миграция 20261031100000): включить —
 * браузер спросит разрешение, телефон запишется за этим сотрудником.
 * iPhone — только из Depter, добавленного на экран «Домой».
 */
export function PushSettings({ isOwner }: { isOwner: boolean }) {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const next: State = !supported
        ? isIos() && !isInstalled()
          ? "ios-install"
          : "unsupported"
        : Notification.permission === "denied"
          ? "denied"
          : (await currentSubscription())
            ? "on"
            : "off";
      if (!cancelled) setState(next);
      // Включено — на всякий случай обновить запись (вошли под другим сотрудником).
      if (next === "on") {
        const sub = (await currentSubscription())?.toJSON();
        if (sub?.endpoint && sub.keys)
          void savePushSubscription({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: navigator.userAgent });
      }
    })().catch(() => !cancelled && setState("unsupported"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setNote(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const sub = (
        await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) })
      ).toJSON();
      if (!sub.endpoint || !sub.keys) throw new Error("no subscription");
      const saved = await savePushSubscription({
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent: navigator.userAgent,
      });
      if (!saved.ok) throw new Error("not saved");
      setState("on");
      setNote("Готово. Нажмите «Проверить» - придёт пробное уведомление.");
    } catch {
      setNote("Не получилось включить. Обновите страницу и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setNote(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      const { sent } = await sendTestPush();
      setNote(sent ? "Отправили - уведомление придёт через несколько секунд." : "Не отправилось. Выключите и включите уведомления снова.");
    } finally {
      setBusy(false);
    }
  }

  const what = isOwner
    ? "Новый заказ из каталога и клиент нажал «Я оплатил»."
    : "Новый заказ из каталога.";
  return (
    <div className="push-settings">
      <p className="muted">
        {what} Уведомление приходит, даже когда Depter закрыт. Включается на каждом телефоне отдельно.
      </p>
      {!publicKey ? (
        <p className="notice">Уведомления ещё не настроены в Depter - скоро появятся.</p>
      ) : state === "loading" ? null : state === "ios-install" ? (
        <p className="notice">
          На iPhone уведомления работают, только если Depter добавлен на экран «Домой»: в Safari нажмите «Поделиться» →
          «На экран Домой», откройте Depter со значка и включите здесь.
        </p>
      ) : state === "unsupported" ? (
        <p className="notice">Этот браузер не умеет уведомления. Откройте Depter в Chrome или установите его на телефон.</p>
      ) : state === "denied" ? (
        <p className="notice">
          Уведомления запрещены для Depter в настройках браузера. Разрешите их там (значок замка у адреса сайта →
          «Уведомления»), потом обновите страницу.
        </p>
      ) : (
        <div className="push-actions">
          {state === "on" ? (
            <>
              <span className="push-on">Включены на этом телефоне</span>
              <button type="button" className="button" disabled={busy} onClick={test}>
                Проверить
              </button>
              <button type="button" className="text-button" disabled={busy} onClick={disable}>
                Выключить
              </button>
            </>
          ) : (
            <button type="button" className="button primary" disabled={busy} onClick={enable}>
              Включить уведомления
            </button>
          )}
        </div>
      )}
      {note && (
        <p className="muted push-note" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
