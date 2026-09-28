"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icon";

type NavItem = [string, string, IconName];

// Товары/склад — Этап 2 по ТЗ, из навигации Этапа 1 скрыты (код и таблицы не убраны).
const nav: NavItem[] = [
  ["/", "Главная", "home"],
  ["/customers", "Клиенты", "people"],
  ["/suppliers", "Поставщики", "truck"],
  ["/money", "Деньги", "wallet"],
  ["/day", "Итог дня", "file"],
  ["/reports", "Итоги", "chart"],
  ["/claims", "Заявки", "check"],
  ["/documents", "Документы", "camera"],
  ["/settings", "Настройки", "settings"],
];
/** Разделы только для владельца (итоги, заявки клиентов). */
const OWNER_ONLY = new Set(["/day", "/reports", "/claims"]);
/** Заголовки страниц без своего пункта меню. */
const EXTRA_TITLES: [string, string][] = [
  ["/money/new", "Новая запись"],
  ["/money/send", "Отправить клиенту"],
  ["/money/adjustment", "Скидка или возврат"],
  ["/money/reverse", "Отменить запись"],
  ["/import", "Перенос из тетради"],
];

/**
 * Каркас кабинета. Телефон (аудит ТЗ 15.1 п. 6): внизу Главная · Клиенты ·
 * [+ Продажа] · Заявки (бейдж — ждущие оплаты) · Ещё; «Ещё» открывает меню
 * над панелью. «Выйти» — только в Настройках (п. 8). ПК: подписи у иконок
 * при любой ширине (п. 11).
 */
export function Shell({
  name,
  children,
  preview = false,
  reviewCount = 0,
  claimsCount = 0,
  isOwner = true,
}: {
  name: string;
  children: React.ReactNode;
  preview?: boolean;
  /** Накладные с расхождением или ошибкой — бейдж у «Документов». */
  reviewCount?: number;
  /** Заявки «Я оплатил», ждущие владельца — главный бейдж. */
  claimsCount?: number;
  isOwner?: boolean;
}) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Переход по ссылке или Esc закрывают меню.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const allowed = ([href]: NavItem) => isOwner || !OWNER_ONLY.has(href);
  const link = (href: string) => (preview ? "/preview" : href);
  const active = (href: string) =>
    href === "/" ? path === "/" || (preview && path === "/preview") : path === href || path.startsWith(href + "/");
  const badge = (href: string) =>
    href === "/claims" && claimsCount > 0 ? (
      <span className="nav-badge">{claimsCount}</span>
    ) : href === "/documents" && reviewCount > 0 ? (
      <span className="nav-badge nav-badge-muted">{reviewCount}</span>
    ) : null;

  // Внизу у продавца вместо «Заявок» (они у владельца) — «Поставщики».
  const bottom: NavItem[] = isOwner
    ? [["/", "Главная", "home"], ["/customers", "Клиенты", "people"], ["/claims", "Заявки", "check"]]
    : [["/", "Главная", "home"], ["/customers", "Клиенты", "people"], ["/suppliers", "Поставщики", "truck"]];
  const more = nav.filter(allowed).filter(([href]) => !bottom.some(([b]) => b === href));
  const moreActive = more.some(([href]) => active(href));
  const pageTitle =
    EXTRA_TITLES.find(([href]) => path.startsWith(href))?.[1] ??
    [...nav].reverse().find(([href]) => active(href))?.[1] ??
    "Depter";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href={link("/")} className="brand">
          Depter<span>учёт долгов без лишнего</span>
        </Link>
        <div className="store">
          <div className="store-mark">{name.slice(0, 1)}</div>
          <div>
            <strong>{name}</strong>
            <small>{isOwner ? "Владелец" : "Продавец"}</small>
          </div>
        </div>
        <nav aria-label="Основная навигация" className="nav-full">
          {nav.filter(allowed).map(([href, label, icon]) => (
            <Link href={link(href)} key={href} className={active(href) ? "active" : ""}>
              <Icon name={icon} />
              <span>{label}</span>
              {badge(href)}
            </Link>
          ))}
        </nav>
        <nav aria-label="Основная навигация" className="nav-compact">
          {bottom.slice(0, 2).map(([href, label, icon]) => (
            <Link href={link(href)} key={href} className={active(href) ? "active" : ""}>
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
          <Link href={link("/money/new?type=sale")} className="nav-primary">
            <Icon name="plus" />
            <span>Продажа</span>
          </Link>
          {bottom.slice(2).map(([href, label, icon]) => (
            <Link href={link(href)} key={href} className={active(href) ? "active" : ""}>
              <Icon name={icon} />
              <span>{label}</span>
              {badge(href)}
            </Link>
          ))}
          <button
            type="button"
            className={menuOpen || moreActive ? "active" : ""}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name={menuOpen ? "close" : "menu"} />
            <span>Ещё</span>
            {!menuOpen && reviewCount > 0 && <span className="nav-badge nav-badge-muted">{reviewCount}</span>}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="status-dot" />
          Пилотная версия<span>Depter / 0.4</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb" aria-label="Магазин и раздел">
            <b className="topbar-store-name">{name}</b>
            <span className="topbar-divider">/</span>
            <b className="topbar-page-title">{pageTitle}</b>
          </span>
        </header>
        {menuOpen && (
          <>
            <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <nav id="mobile-menu" aria-label="Разделы" className="mobile-menu">
              {more.map(([href, label, icon]) => (
                <Link
                  href={link(href)}
                  key={href}
                  className={active(href) ? "active" : ""}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                  {badge(href)}
                </Link>
              ))}
            </nav>
          </>
        )}
        {preview && <div className="preview-banner">Предпросмотр интерфейса · данные не подключены</div>}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
