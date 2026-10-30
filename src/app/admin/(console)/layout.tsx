import { requirePlatformAdmin } from "@/lib/admin";
import { loadFeedback, loadPeople } from "@/lib/admin-data";
import { feedbackDue } from "@/lib/admin-feedback";
import { bishkekDate } from "@/lib/day-summary";
import { adminLogout } from "../actions";
import { AdminBrand } from "@/components/admin-brand";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { db, user } = await requirePlatformAdmin();
  const today = bishkekDate();
  const [people, feedback] = await Promise.all([loadPeople(db), loadFeedback(db)]);
  const due =
    people.filter((p) => p.next_contact && p.next_contact <= today).length + feedback.filter((f) => feedbackDue(f, today)).length;
  const fresh = feedback.filter((f) => f.status === "new").length;
  return (
    <main className="adm">
      <header className="adm-top">
        <AdminBrand />
        <AdminNav due={due} fresh={fresh} />
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
