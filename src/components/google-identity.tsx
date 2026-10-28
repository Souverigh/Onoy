"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { signInWithGoogleIdToken } from "@/app/auth/actions";

/** Скрипт Google Identity Services: кнопка «Войти через Google» на нашей странице. */
const GIS_SRC = "https://accounts.google.com/gsi/client?hl=ru";

type GoogleId = {
  accounts: {
    id: {
      initialize: (config: Record<string, unknown>) => void;
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleId;
  }
}

/** Скрипт грузим один раз на страницу, даже если кнопок несколько. */
let loading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("gis"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Кнопка Google на depter.kg (вместо перехода через supabase.co). Google
 * рисует её сам — так требует Google. Nonce: Google получает его хэш и кладёт
 * в токен, Supabase сверяет с исходным — чужой токен не подойдёт.
 */
export function GoogleIdentityButton({
  clientId,
  business,
  text,
}: {
  clientId: string;
  business?: string;
  /** Надпись Google: «Войти через Google» или «Продолжить с Google». */
  text: "signin_with" | "continue_with";
}) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadGis();
        const raw = new Uint8Array(32);
        crypto.getRandomValues(raw);
        const nonce = hex(raw);
        const hashed = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce)));
        const google = window.google;
        if (cancelled || !google || !box.current) return;
        google.accounts.id.initialize({
          client_id: clientId,
          nonce: hashed,
          ux_mode: "popup",
          use_fedcm_for_button: true,
          callback: ({ credential }: { credential?: string }) => {
            if (!credential) return;
            startTransition(async () => {
              await signInWithGoogleIdToken(credential, nonce, business ?? "");
            });
          },
        });
        google.accounts.id.renderButton(box.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text,
          logo_alignment: "center",
          locale: "ru",
          width: Math.min(400, Math.max(200, box.current.offsetWidth)),
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, business, text]);

  if (failed)
    return (
      <p className="form-error" role="alert">
        Кнопка Google не загрузилась. Обновите страницу или войдите по email и паролю.
      </p>
    );
  return (
    <div className="google-form">
      <div ref={box} className="google-gis" aria-busy={pending} />
      {pending && <small className="muted">Входим…</small>}
    </div>
  );
}
