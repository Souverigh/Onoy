"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  /** Номер клиента, только цифры; пусто — WhatsApp спросит, кому отправить. */
  phone: string;
  /** Текст для wa.me: накладная ссылкой (если сверена) и страница клиента. */
  text: string;
  /** Текст к файлу при «Поделиться» — файл уже приложен, ссылка на страницу клиента остаётся. */
  fileText: string;
  /** Картинка накладной (PNG); null — накладная ещё не сверена. */
  imageUrl: string | null;
  fileName: string;
  /** Распознавание ещё идёт — обновляем страницу, пока не закончится. */
  pending: boolean;
};

const REFRESH_MS = 4000;
const REFRESH_LIMIT = 15;

/**
 * «Отправить клиенту» (задача 8). Телефон: системное «Поделиться» с файлом
 * накладной и текстом со ссылкой — в WhatsApp приходит сам файл. Компьютер
 * (браузер не делится файлами): «Скачать» и «Открыть WhatsApp». share()
 * требует свежего нажатия, поэтому картинку скачиваем заранее.
 */
export function SendInvoice({ phone, text, fileText, imageUrl, fileName, pending }: Props) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [canShareFile, setCanShareFile] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "retry" | "error" | "sent">("idle");
  const refreshes = useRef(0);

  const waHref = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  const waFileHref = `https://wa.me/${phone}?text=${encodeURIComponent(fileText)}`;

  useEffect(() => {
    if (!imageUrl || typeof navigator.canShare !== "function") return;
    const probe = new File([""], "probe.png", { type: "image/png" });
    if (!navigator.canShare({ files: [probe] })) return;
    setCanShareFile(true);
    let cancelled = false;
    fetch(imageUrl)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!cancelled) setFile(new File([blob], fileName, { type: "image/png" }));
      })
      .catch(() => {
        if (!cancelled) setCanShareFile(false);
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, fileName]);

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
    let image = file;
    if (!image) {
      setState("loading");
      try {
        const res = await fetch(imageUrl!);
        if (!res.ok) throw new Error(String(res.status));
        image = new File([await res.blob()], fileName, { type: "image/png" });
        setFile(image);
      } catch {
        setState("error");
        return;
      }
    }
    const data: ShareData = { files: [image], text: fileText };
    // Пробный файл прошёл, а настоящий могут отклонить (имя, размер) — тогда
    // share() падает без окна, и кнопка «ничего не делает».
    if (!navigator.canShare(data)) {
      setState("error");
      return;
    }
    try {
      await navigator.share(data);
      setState("sent");
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      // AbortError — продавец сам закрыл окно; NotAllowedError — пока качали
      // файл, «нажатие» устарело: файл уже готов, второе нажатие сработает.
      setState(name === "AbortError" ? "idle" : name === "NotAllowedError" ? "retry" : "error");
    }
  }

  // Накладная не сверена — только текст с долгом и ссылкой.
  if (!imageUrl)
    return (
      <div className="send-invoice">
        <a className="button primary send-main" href={waHref} target="_blank" rel="noreferrer">
          Отправить клиенту в WhatsApp
        </a>
      </div>
    );

  if (canShareFile)
    return (
      <div className="send-invoice">
        <button className="button primary send-main" type="button" onClick={shareFile} disabled={state === "loading"}>
          {state === "loading" ? "Готовим накладную…" : state === "retry" ? "Накладная готова — отправить" : "Отправить клиенту"}
        </button>
        {state === "sent" && <p className="muted">Отправлено? Если WhatsApp не открылся — нажмите ещё раз.</p>}
        {state === "error" && (
          <p className="form-error" role="alert">
            Не удалось приложить файл.{" "}
            <a href={waHref} target="_blank" rel="noreferrer">
              Отправить текстом со ссылкой
            </a>
          </p>
        )}
      </div>
    );

  return (
    <div className="send-invoice send-invoice-desktop">
      <p className="send-invoice-title">Отправить клиенту</p>
      <div className="send-invoice-actions">
        <a className="button primary" href={`${imageUrl}?download=1`} download={fileName}>
          1. Скачать накладную
        </a>
        <a className="button primary" href={waFileHref} target="_blank" rel="noreferrer">
          2. Открыть WhatsApp
        </a>
      </div>
      <small className="muted">
        В WhatsApp перетащите скачанный файл в чат с клиентом — текст со ссылкой уже будет вписан.
      </small>
    </div>
  );
}
