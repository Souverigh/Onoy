"use client";
import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FirstStep } from "@/lib/first-steps";
import { InstallApp } from "./install-app";

/**
 * Тур по главной: подсвечивает часть экрана и объясняет её. Элемента нет или он
 * скрыт (на телефоне другое меню) — шаг пропускается.
 */
const TOUR = [
  {
    selector: ".first-steps-list li.next",
    title: "С чего начать",
    text: "Начните с этого шага. Галочка поставится сама, когда дело будет сделано, - и откроется следующий.",
  },
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
    selector: ".dashboard-search",
    title: "Поиск клиента",
    text: "Имя или телефон - и сразу его долг, история и кнопка напомнить.",
  },
  {
    selector: ".nav-primary",
    title: "Главная кнопка",
    text: "Она всегда под рукой, на любой странице.",
  },
] as const;

const visible = (el: Element | null): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

/** Отступ подсветки вокруг места и подсказки от краёв экрана. */
const PAD = 8;
const EDGE = 16;

function Tour({ onClose }: { onClose: () => void }) {
  const [steps] = useState(() => TOUR.filter((s) => visible(document.querySelector(s.selector))));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = step && document.querySelector(step.selector);
    setBox(visible(el) ? el.getBoundingClientRect() : null);
  }, [step]);

  // Место не видно целиком — листаем так, чтобы оно было вверху экрана, а под
  // ним осталось место для подсказки. Повторяем чуть позже: страница могла сдвинуться.
  const show = useCallback(() => {
    const el = step && document.querySelector(step.selector);
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    if (r.top < EDGE * 4 || r.bottom > window.innerHeight - EDGE)
      window.scrollTo({ top: window.scrollY + r.top - EDGE * 5, behavior: "instant" as ScrollBehavior });
    measure();
  }, [step, measure]);

  useLayoutEffect(() => {
    show();
    const later = setTimeout(show, 350);
    return () => clearTimeout(later);
  }, [show]);

  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? 0;
    if (h !== cardHeight) setCardHeight(h);
  });

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
  // Подсказка — под местом, если влезает, иначе над ним; не влезает нигде — внизу
  // экрана. Всегда целиком на экране.
  const height = window.innerHeight;
  const top = !box
    ? (height - cardHeight) / 2
    : height - box.bottom >= cardHeight + EDGE * 2
      ? box.bottom + EDGE
      : box.top >= cardHeight + EDGE * 2
        ? box.top - EDGE - cardHeight
        : height - cardHeight - EDGE;
  // В body: внутри карточки «fixed» считался бы от неё, и подсветка съезжала.
  return createPortal(
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box && (
        <div
          className="tour-spot"
          style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 }}
        />
      )}
      <div ref={card} className="tour-card" style={{ top: Math.max(EDGE, Math.min(top, height - cardHeight - EDGE)) }}>
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
    // Сам тур — чуть позже, когда страница встанет на место.
    if (wasHidden || seen) return;
    const start = setTimeout(() => setTour(true), 600);
    return () => clearTimeout(start);
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
        {steps.map((s) => {
          const mark = (
            <span className="first-steps-mark" aria-hidden="true">
              {s.done ? "✓" : ""}
            </span>
          );
          // Сделано — зачёркнуто; следующий — с пояснением и кнопкой; остальные — строка-ссылка.
          if (s.done)
            return (
              <li key={s.id} className="done">
                {mark}
                <strong>{s.title}</strong>
              </li>
            );
          if (s === next)
            return (
              <li key={s.id} className="next">
                {mark}
                <span className="first-steps-text">
                  <strong>{s.title}</strong>
                  <small className="muted">{s.text}</small>
                </span>
                <Link className="button primary" href={s.href}>
                  {s.button}
                </Link>
              </li>
            );
          return (
            <li key={s.id}>
              <Link className="first-steps-row" href={s.href}>
                {mark}
                <strong>{s.title}</strong>
                <span className="first-steps-go" aria-hidden="true">
                  ›
                </span>
              </Link>
            </li>
          );
        })}
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
