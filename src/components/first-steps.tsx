"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { FirstStep } from "@/lib/first-steps";
import { InstallApp } from "./install-app";

/**
 * Тур по главной: подсвечивает часть экрана и объясняет её. Элемента нет или он
 * скрыт (на телефоне другое меню) — шаг пропускается.
 */
const TOUR = [
  {
    selector: ".debt-cards",
    title: "Кто сколько должен",
    text: "Слева - сколько должны вам клиенты, справа - сколько вы должны поставщикам. Нажмите на карточку - откроется список.",
  },
  {
    selector: ".quick-actions",
    title: "Каждый день - отсюда",
    text: "Кнопки под ваш вид бизнеса: записать продажу, принять деньги от клиента, расход.",
  },
  {
    selector: ".nav-primary",
    title: "Главная кнопка",
    text: "Она всегда под рукой, на любой странице.",
  },
  {
    selector: ".dashboard-search",
    title: "Поиск клиента",
    text: "Имя или телефон - и сразу его долг, история и кнопка напомнить.",
  },
  {
    selector: ".first-steps",
    title: "С чего начать",
    text: "Отмечайте первые шаги - галочка ставится сама, когда дело сделано.",
  },
] as const;

const visible = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

function Tour({ onClose }: { onClose: () => void }) {
  const steps = TOUR.filter((s) => visible(document.querySelector(s.selector)));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = step && document.querySelector(step.selector);
    setBox(visible(el) ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    const el = step && document.querySelector(step.selector);
    if (!visible(el)) return;
    // Листаем, только если место не видно целиком: меньше прыжков.
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight)
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
    measure();
    // Страница могла ещё доскролливаться — меряем и на следующем кадре.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [step, measure]);

  useEffect(() => {
    const keys = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("keydown", keys);
    // Страница сдвинулась (появилась кнопка установки, догрузился шрифт) — меряем заново.
    const resized = new ResizeObserver(measure);
    resized.observe(document.body);
    return () => {
      resized.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", keys);
    };
  }, [measure, onClose]);

  if (!step) return null;
  const last = i === steps.length - 1;
  // Карточка с пояснением — под подсвеченным местом или над ним, где больше места.
  const below = !box || box.top + box.height / 2 < window.innerHeight / 2;
  const pad = 8;
  // В body: внутри карточки «fixed» считался бы от неё, и подсветка съезжала.
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box && (
        <div
          className="tour-spot"
          style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
        />
      )}
      <div
        className="tour-card"
        style={
          box
            ? below
              ? { top: Math.min(box.bottom + pad * 2, window.innerHeight - 220) }
              : { top: Math.max(box.top - pad * 2, 0), transform: "translate(-50%, -100%)" }
            : { top: "30%" }
        }
      >
        <span className="eyebrow">
          {i + 1} из {steps.length}
        </span>
        <h2 id="tour-title">{step.title}</h2>
        <p>{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={onClose}>
            Пропустить
          </button>
          {i > 0 && (
            <button type="button" className="button" onClick={() => setI(i - 1)}>
              Назад
            </button>
          )}
          <button type="button" className="button primary" onClick={() => (last ? onClose() : setI(i + 1))} autoFocus>
            {last ? "Понятно" : "Дальше"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * «Первые шаги» нового магазина и тур «где что». Тур открывается сам один раз
 * (помним в браузере), потом — по кнопке. «Скрыть» убирает карточку на этом
 * устройстве; сделано всё — карточка пропадает сама (src/lib/first-steps.ts).
 */
export function FirstSteps({ steps, shopId }: { steps: FirstStep[]; shopId: string }) {
  const hideKey = `depter-first-steps-hidden-${shopId}`;
  const tourKey = `depter-tour-seen-${shopId}`;
  const [hidden, setHidden] = useState(true);
  const [tour, setTour] = useState(false);

  useEffect(() => {
    let wasHidden = false;
    let seen = true;
    try {
      wasHidden = localStorage.getItem(hideKey) === "1";
      seen = localStorage.getItem(tourKey) === "1";
    } catch {}
    setHidden(wasHidden);
    if (!wasHidden && !seen) setTour(true);
  }, [hideKey, tourKey]);

  const closeTour = useCallback(() => {
    setTour(false);
    try {
      localStorage.setItem(tourKey, "1");
    } catch {}
  }, [tourKey]);

  if (hidden) return null;
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  return (
    <section className="panel first-steps" aria-label="Первые шаги">
      <div className="section-title">
        <h2>Первые шаги</h2>
        <span className="muted">
          {done} из {steps.length}
        </span>
      </div>
      <div className="first-steps-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="first-steps-list">
        {steps.map((s) => (
          <li key={s.id} className={s.done ? "done" : s === next ? "next" : undefined}>
            <span className="first-steps-mark" aria-hidden="true">
              {s.done ? "✓" : ""}
            </span>
            <span className="first-steps-text">
              <strong>{s.title}</strong>
              {!s.done && <small className="muted">{s.text}</small>}
            </span>
            {!s.done && (
              <Link className={s === next ? "button primary" : "button"} href={s.href}>
                {s.button}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <InstallApp variant="button" />
      <div className="first-steps-foot">
        <button type="button" className="text-button" onClick={() => setTour(true)}>
          Показать, где что на экране
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(hideKey, "1");
            } catch {}
          }}
        >
          Скрыть
        </button>
      </div>
      {tour && <Tour onClose={closeTour} />}
    </section>
  );
}
