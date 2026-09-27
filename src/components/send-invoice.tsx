"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /** Номер клиента, только цифры; пусто — WhatsApp спросит, кому отправить. */
  phone: string;
  /** Текст для wa.me: со ссылкой на PDF, если накладная сверена. */
  text: string;
  /** Текст к файлу при «Поделиться» — без ссылки на PDF, файл уже приложен. */
  fileText: string;
  /** PDF для «Поделиться» (кабинет магазина); null — накладная не сверена. */
  pdfUrl: string | null;
  fileName: string;
  /** Распознавание ещё идёт — обновляем страницу, пока не закончится. */
  pending: boolean;
};

const REFRESH_MS = 4000;
const REFRESH_LIMIT = 15;

// Ссылка wa.me передаёт только текст. Файл в WhatsApp уходит через системное
// «Поделиться» (Web Share API с файлами — Android Chrome, iOS Safari).
// share() требует свежего нажатия, поэтому PDF скачиваем заранее.
export function SendInvoice({ phone, text, fileText, pdfUrl, fileName, pending }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [canShareFile, setCanShareFile] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "retry" | "error">("idle");
  const refreshes = useRef(0);

  const waHref = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

  useEffect(() => {
    if (!pdfUrl || typeof navigator.canShare !== "function") return;
    const probe = new File([""], "probe.pdf", { type: "application/pdf" });
    if (!navigator.canShare({ files: [probe] })) return;
    setCanShareFile(true);
    let cancelled = false;
    fetch(pdfUrl)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!cancelled) setFile(new File([blob], fileName, { type: "application/pdf" }));
      })
      .catch(() => {
        if (!cancelled) setCanShareFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, fileName]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (refreshes.current >= REFRESH_LIMIT) return clearInterval(timer);
      refreshes.current += 1;
      router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  async function shareFile() {
    let pdf = file;
    if (!pdf) {
      setState("loading");
      try {
        const res = await fetch(pdfUrl!);
        if (!res.ok) throw new Error(String(res.status));
        pdf = new File([await res.blob()], fileName, { type: "application/pdf" });
        setFile(pdf);
      } catch {
        setState("error");
        return;
      }
    }
    try {
      await navigator.share({ files: [pdf], text: fileText });
      setState("idle");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      // AbortError — продавец сам закрыл окно; NotAllowedError — пока качали
      // файл, «нажатие» устарело: файл уже готов, второе нажатие сработает.
      setState(name === "AbortError" ? "idle" : name === "NotAllowedError" ? "retry" : "error");
    }
  }

  if (!canShareFile)
    return (
      <div className="send-invoice">
        <a className="button primary" href={waHref} target="_blank" rel="noreferrer">
          Отправить в WhatsApp
        </a>
      </div>
    );

  return (
    <div className="send-invoice">
      <button
        className="button primary"
        type="button"
        onClick={shareFile}
        disabled={state === "loading"}
      >
        {state === "loading"
          ? "Готовим PDF…"
          : state === "retry"
            ? "PDF готов — отправить"
            : "Отправить PDF в WhatsApp"}
      </button>
      <a className="button" href={waHref} target="_blank" rel="noreferrer">
        Только текст со ссылкой
      </a>
      {state === "error" && (
        <p className="form-error" role="alert">
          Не удалось приложить PDF. Отправьте текстом — кнопка рядом.
        </p>
      )}
    </div>
  );
}
