"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/** Меню админки; «Связаться» — у кого подошла дата из заметки, «Заявки» — сколько новых. */
export function AdminNav({ due, fresh }: { due: number; fresh: number }) {
  const path = usePathname();
  const contact = useSearchParams().get("f") === "contact";
  const on = (match: boolean) => (match ? "on" : undefined);
  return (
    <nav className="adm-nav">
      <Link className={on((path === "/admin" && !contact) || path.startsWith("/admin/shop") || path.startsWith("/admin/account"))} href="/admin">
        Магазины
      </Link>
      <Link className={on(path.startsWith("/admin/funnel"))} href="/admin/funnel">
        Воронка
      </Link>
      <Link className={on(path === "/admin" && contact)} href="/admin?f=contact">
        Связаться{due > 0 && <b>{due}</b>}
      </Link>
      <Link className={on(path.startsWith("/admin/feedback"))} href="/admin/feedback">
        Заявки{fresh > 0 && <b>{fresh}</b>}
      </Link>
      <Link className={on(path.startsWith("/admin/codes"))} href="/admin/codes">
        Коды
      </Link>
      <Link className={on(path.startsWith("/admin/team"))} href="/admin/team">
        Команда
      </Link>
    </nav>
  );
}
