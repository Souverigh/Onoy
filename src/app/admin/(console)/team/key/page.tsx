import Link from "next/link";
import { enrollAdminKey, requirePlatformAdmin } from "@/lib/admin";
import { AdminKeySetup } from "@/components/admin-key-setup";

/** «Подключить ещё телефон»: запасной ключ или новый телефон вместо старого. */
export default async function AdminAddKey() {
  const { db } = await requirePlatformAdmin();
  const setup = await enrollAdminKey(db);
  return (
    <div className="adm-key-page">
      <Link className="adm-back" href="/admin/team">
        ← Назад в «Команду»
      </Link>
      <section className="adm-login-card">
        <h1>Подключить ещё телефон</h1>
        <p className="muted">Потеряете один телефон - войдёте со второго.</p>
        {setup ? (
          <AdminKeySetup setup={setup} next="team" label="Подключить" />
        ) : (
          <p className="form-error" role="alert">
            Не удалось подготовить ключ. Обновите страницу.
          </p>
        )}
      </section>
    </div>
  );
}
