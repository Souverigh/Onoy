"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FirstStep } from "@/lib/first-steps";
import { InstallApp } from "./install-app";
import { Icon } from "./action-icon";
import { FeatureSheet } from "./feature-sheet";

/**
 * Тур по главной: подсвечивает часть экрана и объясняет её. Элемента нет или он
 * скрыт (на телефоне другое меню) — шаг пропускается.
 */
const TOUR = [
  {
    selector: ".first-steps-next",
    title: "С чего начать",
    text: "Начните с этого шага. Галочка поставится сама, когда дело будет сделано, - и откроется следующий.",
  },
  {
    selector: ".debt-cards",
    title: "Кто сколько должен",
    text: "Слева - сколько должны вам клиенты, справа - сколько вы должны поставщикам. Нажмите на карточку - откроется список.",
  },
  {
    selector: ".attention",
    title: "Требуют внимания",
    text: "Здесь появляется то, что ждёт ответа: оплаты от клиентов, заказы, накладные. Нет блока - значит, всё в порядке.",
  },
  {
    selector: ".quick-actions",
    title: "Что произошло?",
    text: "Каждый день - отсюда: с клиентами слева, с поставщиками справа. Тёмная кнопка - главная.",
  },
  {
    selector: ".remind-today",
    title: "Кому напомнить",
    text: "Кто обещал заплатить сегодня или давно должен. Одна кнопка - и напоминание уходит в WhatsApp.",
  },
  {
    selector: ".home-search, .home-search-icon",
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

/** Первое видимое место по селектору: на телефоне и компьютере оно бывает разным (поле поиска или значок). */
const find = (selector: string) => [...document.querySelectorAll(selector)].find(visible) ?? null;

/** Отступ подсветки вокруг места и подсказки от краёв экрана. */
const PAD = 8;
const EDGE = 16;

function Tour({ onClose }: { onClose: () => void }) {
  const [steps] = useState(() => TOUR.filter((s) => find(s.selector)));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<DOMRect | null>(null);
  const [cardHeight, setCardHeight] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = step && find(step.selector);
    setBox(el ? el.getBoundingClientRect() : null);
  }, [step]);

  // Место не видно целиком — листаем так, чтобы оно было вверху экрана, а под
  // ним осталось место для подсказки. Повторяем чуть позже: страница могла сдвинуться.
  const show = useCallback(() => {
    const el = step && find(step.selector);
    if (!el) return;
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
  // Нажатый шаг: сначала объяснение, в форму — кнопкой из него.
  const [open, setOpen] = useState<FirstStep | null>(null);

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
  // Как на главной: следующий шаг — тёмной плиткой (как главная кнопка), остальные —
  // строками; сделанные — с галочкой, зачёркнуты.
  return (
    <section className="first-steps" aria-labelledby="first-steps-title">
      <div className="first-steps-head">
        <h2 id="first-steps-title">Первые шаги</h2>
        <span>
          {done} из {steps.length}
        </span>
      </div>
      <div className="first-steps-bar" aria-hidden="true">
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      {next && (
        <button type="button" className="first-steps-next" onClick={() => setOpen(next)}>
          <Icon name={next.icon} />
          <span className="first-steps-next-text">
            <small>Шаг {steps.indexOf(next) + 1}</small>
            <strong>{next.title}</strong>
            <span>{next.text}</span>
          </span>
          <span className="first-steps-go" aria-hidden="true">
            ›
          </span>
        </button>
      )}
      <ol className="first-steps-list">
        {steps
          .filter((s) => s !== next)
          .map((s) =>
            s.done ? (
              <li key={s.id} className="done">
                <span className="first-steps-mark" aria-hidden="true">
                  ✓
                </span>
                <strong>{s.title}</strong>
              </li>
            ) : (
              <li key={s.id}>
                <button type="button" className="first-steps-row" onClick={() => setOpen(s)}>
                  <Icon name={s.icon} size={20} />
                  <strong>{s.title}</strong>
                  <span className="first-steps-go" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ),
          )}
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
      <FeatureSheet
        content={open && { ...open, button: { label: open.button, href: open.href } }}
        icon={open && <Icon name={open.icon} size={21} />}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}
