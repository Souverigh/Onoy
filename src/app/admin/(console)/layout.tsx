import { requirePlatformAdmin } from "@/lib/admin";
import { loadPeople } from "@/lib/admin-data";
import { bishkekDate } from "@/lib/day-summary";
import { adminLogout } from "../actions";
import { AdminBrand } from "@/components/admin-brand";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { db, user } = await requirePlatformAdmin();
  const today = bishkekDate();
  const due = (await loadPeople(db)).filter((p) => p.next_contact && p.next_contact <= today).length;
  return (
    <main className="adm">
      <header className="adm-top">
        <AdminBrand />
        <AdminNav due={due} />
        <span className="adm-me">
          {user.email}
          <form action={adminLogout}>
            <button className="text-button">Выйти</button>
          </form>
        </span>
      </header>
      {children}
    </main>
  );
}
