"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./icon";
import { InstallApp } from "./install-app";
import { REPORT_TAB_KEY, reportTabHref } from "./report-tabs";
import { DEFAULT_BUSINESS, MODULE_IDS, navLabel, type BusinessType, type ModuleId } from "@/lib/business";
import { newestNews, unreadNews, type NewsEntry } from "@/lib/changelog";
import { WhatsNewDialog, readNewsSeen, saveNewsSeen } from "./whats-new";

/** Адрес, название, иконка и модуль (src/lib/business.ts), если раздел не из ядра. */
type NavItem = [string, string, IconName, ModuleId?];

// Склад — с 30.09.2026 (товары, остатки, продажа товарами); на телефоне — в «Ещё».
const allNav: NavItem[] = [
  ["/", "Главная", "home"],
  ["/customers", "Клиенты", "people"],
  ["/suppliers", "Поставщики", "truck"],
  ["/money", "Все записи", "wallet"],
  ["/stock", "Склад", "box", "stock"],
  // Итог дня, отчёт за месяц и продавцы — вкладками одного раздела (report-tabs.tsx).
  ["/day", "Отчёты", "chart"],
  ["/claims", "Платежи", "check"],
  // Заказы клиентов из каталога (задача № 12) — видят все, продажу делает и продавец.
  ["/orders", "Заказы", "cart", "catalog"],
  ["/documents", "Документы", "camera"],
  // «Что нового» (src/lib/changelog.ts): окно на главной и лента обновлений.
  ["/news", "Что нового", "spark"],
  ["/settings", "Настройки", "settings"],
];
/** Разделы только для владельца (итоги, заявки клиентов). */
const OWNER_ONLY = new Set(["/day", "/claims"]);
/** Страницы раздела «Отчёты» — пункт меню подсвечен на любой из них. */
const REPORT_PATHS = ["/day", "/reports", "/sellers"];
/** Заголовки страниц без своего пункта меню. */
const EXTRA_TITLES: [string, string][] = [
  ["/money/new", "Новая запись"],
  // Открываются с главной («Продажа», «Товар от поставщика»), в меню их нет.
  ["/sales", "Продажи"],
  ["/purchases", "Приход"],
  ["/money/send", "Отправить клиенту"],
  ["/money/adjustment", "Скидка или возврат"],
  ["/money/reverse", "Отменить запись"],
  ["/import", "Перенос из тетради"],
  ["/stock/new", "Новый товар"],
  ["/stock/import", "Товары из Excel"],
];

/**
 * Каркас кабинета. Телефон (аудит ТЗ 15.1 п. 6): внизу Главная · Клиенты ·
 * [+ Продажа] · Отчёты · Ещё; «Ещё» открывает меню над панелью (там же
 * Платежи — их бейдж выносится на «Ещё»). «Выйти» — только в Настройках (п. 8). ПК: подписи у иконок
 * при любой ширине (п. 11).
 */
export function Shell({
  name,
  children,
  preview = false,
  reviewCount = 0,
  claimsCount = 0,
  ordersCount = 0,
  isOwner = true,
  business = DEFAULT_BUSINESS,
  modules = MODULE_IDS,
  news = [],
  shopCreatedAt = null,
}: {
  name: string;
  children: React.ReactNode;
  preview?: boolean;
  /** Накладные с расхождением или ошибкой — бейдж у «Документов». */
  reviewCount?: number;
  /** Заявки «Я оплатил», ждущие владельца — главный бейдж. */
  claimsCount?: number;
  /** Новые заказы из каталога — бейдж у «Заказов». */
  ordersCount?: number;
  isOwner?: boolean;
  /** Вид бизнеса — названия разделов (у кафе «Склад» — «Продукты»). */
  business?: BusinessType;
  /** Включённые модули: разделы выключенных скрыты из меню, данные остаются. */
  modules?: readonly ModuleId[];
  /** «Что нового» для этого человека (роль, модули) и когда открыт магазин. */
  news?: NewsEntry[];
  shopCreatedAt?: string | null;
}) {
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Непрочитанное «Что нового» — по отметке в браузере; в разделе — прочитано.
  const [unread, setUnread] = useState<NewsEntry[]>([]);
  useEffect(() => {
    if (preview) return;
    if (path === "/news") {
      saveNewsSeen(newestNews(news));
      setUnread([]);
      return;
    }
    setUnread(unreadNews(news, readNewsSeen(), new Date().toISOString().slice(0, 10), shopCreatedAt));
  }, [path, news, shopCreatedAt, preview]);
  const closeNews = () => {
    saveNewsSeen(newestNews(news));
    setUnread([]);
  };
  // Переход по ссылке или Esc закрывают меню.
  useEffect(() => setMenuOpen(false), [path]);
  // Выпадающие меню на <details> («Скачать», «⋯ Ещё»): нажатие мимо меню,
  // выбор пункта или Esc — закрыть. Сами <details> так не умеют.
  useEffect(() => {
    const closeAll = (keep?: Node | null) =>
      document.querySelectorAll<HTMLDetailsElement>("details.more-menu[open]").forEach((menu) => {
        if (!keep || !menu.contains(keep)) menu.open = false;
      });
    // Нажатие мимо меню — закрыть; внутри меню — оставить открытым.
    const onPointer = (e: PointerEvent) => closeAll(e.target as Node | null);
    // Выбрали пункт — закрыть уже после клика, чтобы переход или скачивание успели начаться.
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("details.more-menu .more-menu-list a")) closeAll();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeAll();
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    document.querySelectorAll<HTMLDetailsElement>("details.more-menu[open]").forEach((menu) => (menu.open = false));
  }, [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // «Отчёты» ведут на последнюю открытую вкладку (запоминает report-tabs.tsx).
  const [reportsHref, setReportsHref] = useState("/day");
  useEffect(() => {
    try {
      setReportsHref(reportTabHref(localStorage.getItem(REPORT_TAB_KEY)));
    } catch {
      // Приватный режим — «День».
    }
  }, [path]);
  // Продавцу отчёты не видны — у него вместо них «Мои продажи».
  const nav = (isOwner ? allNav : allNav.map((item): NavItem => (item[0] === "/day" ? ["/sellers", "Мои продажи", "chart"] : item)))
    .filter(([, , , module]) => !module || modules.includes(module))
    .map(([href, label, icon, module]): NavItem => [href, navLabel(business, href, label), icon, module]);
  const ordersOn = modules.includes("catalog");
  const allowed = ([href]: NavItem) => isOwner || !OWNER_ONLY.has(href);
  const inPath = (href: string) => path === href || path.startsWith(href + "/");
  const link = (href: string) => (preview ? "/preview" : isOwner && href === "/day" ? reportsHref : href);
  const active = (href: string) =>
    href === "/"
      ? path === "/" || (preview && path === "/preview")
      : isOwner && href === "/day"
        ? REPORT_PATHS.some(inPath)
        : inPath(href);
  const badge = (href: string) =>
    href === "/claims" && claimsCount > 0 ? (
      <span className="nav-badge">{claimsCount}</span>
    ) : href === "/orders" && ordersCount > 0 ? (
      <span className="nav-badge">{ordersCount}</span>
    ) : href === "/documents" && reviewCount > 0 ? (
      <span className="nav-badge nav-badge-muted">{reviewCount}</span>
    ) : href === "/news" && unread.length > 0 ? (
      <span className="nav-badge nav-badge-muted">{unread.length}</span>
    ) : null;

  // Внизу у продавца вместо «Итога дня» (итоги — у владельца) — «Поставщики».
  const bottom: NavItem[] = isOwner
    ? [["/", "Главная", "home"], ["/customers", "Клиенты", "people"], ["/day", "Отчёты", "chart"]]
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
            {/* «Платежи» и «Заказы» в меню — их бейджи главнее накладных. */}
            {!menuOpen &&
              (isOwner && claimsCount > 0 ? (
                <span className="nav-badge">{claimsCount}</span>
              ) : ordersOn && ordersCount > 0 ? (
                <span className="nav-badge">{ordersCount}</span>
              ) : reviewCount > 0 ? (
                <span className="nav-badge nav-badge-muted">{reviewCount}</span>
              ) : unread.length > 0 ? (
                <span className="nav-badge nav-badge-muted">{unread.length}</span>
              ) : null)}
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
        <main className="content">
          {/* Предложение поставить значок на телефон — только на главной, можно скрыть. */}
          {!preview && path === "/" && <InstallApp variant="banner" />}
          {/* После обновления — один раз окном; «Понятно» — до следующего. */}
          {!preview && path === "/" && unread.length > 0 && <WhatsNewDialog entries={unread} onClose={closeNews} />}
          {children}
        </main>
      </div>
    </div>
  );
}
