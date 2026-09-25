"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "./icon";
import { logout } from "@/app/auth/actions";
const nav: [string, string, IconName][] = [
  ["/", "Главная", "home"],
  ["/customers", "Клиенты", "people"],
  ["/products", "Товары", "box"],
  ["/money", "Деньги", "wallet"],
  ["/documents", "Документы", "file"],
  ["/settings", "Настройки", "settings"],
];
export function Shell({
  name,
  children,
  preview = false,
}: {
  name: string;
  children: React.ReactNode;
  preview?: boolean;
}) {
  const path = usePathname();
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href={preview ? "/preview" : "/"} className="brand">
          Oŋoy<span>учёт без лишнего</span>
        </Link>
        <div className="store">
          <div className="store-mark">{name.slice(0, 1)}</div>
          <div>
            <strong>{name}</strong>
            <small>Рабочий кабинет</small>
          </div>
        </div>
        <nav aria-label="Основная навигация">
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
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="status-dot" />
          Пилотная версия<span>Oŋoy / 0.1</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span className="breadcrumb">
            Мой магазин <span>/</span>{" "}
            <b>
              {nav.find((n) => n[0] === path)?.[1] ??
                (preview ? "Главная" : "Справочники")}
            </b>
          </span>
          <div className="top-actions">
            <span className="currency">KGS · сом</span>
            {!preview && (
              <form action={logout}>
                <button className="text-button">Выйти</button>
              </form>
            )}
            <span className="avatar">{name.slice(0, 1)}</span>
          </div>
        </header>
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
