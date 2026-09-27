import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/admin";
import { logout } from "@/app/auth/actions";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requirePlatformAdmin();
  return (
    <main className="admin">
      <header className="admin-header">
        <strong>Depter · администрирование</strong>
        <nav className="pill-switch">
          <Link href="/admin">Магазины</Link>
          <Link href="/admin/codes">Коды доступа</Link>
        </nav>
        <span className="muted">
          {user.email}
          <form action={logout} className="admin-logout">
            <button className="text-button">Выйти</button>
          </form>
        </span>
      </header>
      {children}
    </main>
  );
}
