"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icon";
import { logout } from "@/app/auth/actions";
// Товары/склад — Этап 2 по ТЗ, из навигации Этапа 1 скрыты (код и таблицы не убраны).
const nav: [string, string, IconName][] = [
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
const mobileNav: [string, string, IconName][] = [
  ["/", "Главная", "home"],
  ["/customers", "Клиенты", "people"],
  ["/suppliers", "Поставщики", "truck"],
];
// На телефоне внизу — только основные разделы, остальные — в меню-бургере сверху.
const moreNav: [string, string, IconName][] = [
  ["/money", "Деньги", "wallet"],
  ["/day", "Итог дня", "file"],
  ["/reports", "Итоги", "chart"],
  ["/claims", "Заявки", "check"],
  ["/documents", "Документы", "camera"],
  ["/settings", "Настройки", "settings"],
];
export function Shell({
  name,
  children,
  preview = false,
  reviewCount = 0,
}: {
  name: string;
  children: React.ReactNode;
  preview?: boolean;
  reviewCount?: number;
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
  const pageTitle =
    nav.find((n) => n[0] === path)?.[1] ??
    (preview ? "Главная" : "Справочники");
  const moreActive = moreNav.some(
    ([href]) => path === href || path.startsWith(href + "/"),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href={preview ? "/preview" : "/"} className="brand">
          Depter<span>учёт долгов без лишнего</span>
        </Link>
        <div className="store">
          <div className="store-mark">{name.slice(0, 1)}</div>
          <div>
            <strong>{name}</strong>
            <small>Рабочий кабинет</small>
          </div>
        </div>
        <nav aria-label="Основная навигация" className="nav-full">
          {nav.map(([href, label, icon]) => (
            <Link
              href={preview ? "/preview" : href}
              key={href}
              className={
                path === href ||
                path.startsWith(href + "/") ||
                (preview && href === "/")
                  ? "active"
                  : ""
              }
            >
              <Icon name={icon} />
              <span>{label}</span>
              {href === "/documents" && reviewCount > 0 && (
                <span className="nav-badge">{reviewCount}</span>
              )}
            </Link>
          ))}
        </nav>
        <nav aria-label="Основная навигация" className="nav-compact">
          {mobileNav.map(([href, label, icon]) => (
            <Link
              href={preview ? "/preview" : href}
              key={href}
              className={
                path === href ||
                path.startsWith(href + "/") ||
                (preview && href === "/")
                  ? "active"
                  : ""
              }
            >
              <Icon name={icon} />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-dot" />
          Пилотная версия<span>Depter / 0.3</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb" aria-label="Магазин и раздел">
            <b className="topbar-store-name">{name}</b>
            <span className="topbar-divider">/</span>
            <b className="topbar-page-title">{pageTitle}</b>
          </span>
          <div className="top-actions">
            {!preview && (
              <form action={logout}>
                <button className="text-button topbar-logout">Выйти</button>
              </form>
            )}
            <button
              className={`menu-toggle${moreActive ? " active" : ""}`}
              type="button"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
              {!menuOpen && reviewCount > 0 && (
                <span className="nav-badge menu-toggle-badge">{reviewCount}</span>
              )}
            </button>
          </div>
        </header>
        {menuOpen && (
          <>
            <div className="mobile-menu-backdrop" onClick={() => setMenuOpen(false)} />
            <nav id="mobile-menu" aria-label="Разделы" className="mobile-menu">
              {moreNav.map(([href, label, icon]) => (
                <Link
                  href={preview ? "/preview" : href}
                  key={href}
                  className={path === href || path.startsWith(href + "/") ? "active" : ""}
                  onClick={() => setMenuOpen(false)}
                >
                  <Icon name={icon} />
                  <span>{label}</span>
                  {href === "/documents" && reviewCount > 0 && (
                    <span className="nav-badge">{reviewCount}</span>
                  )}
                </Link>
              ))}
              {!preview && (
                <form action={logout} className="mobile-menu-logout">
                  <button type="submit">Выйти</button>
                </form>
              )}
            </nav>
          </>
        )}
        {preview && (
          <div className="preview-banner">
            Предпросмотр интерфейса · данные не подключены
          </div>
        )}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
