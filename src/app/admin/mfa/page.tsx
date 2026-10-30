import { redirect } from "next/navigation";
import { adminSession, enrollAdminKey } from "@/lib/admin";
import { adminLogout } from "../actions";
import { AdminBrand } from "@/components/admin-brand";
import { AdminCodeForm } from "@/components/admin-code-form";
import { AdminKeySetup } from "@/components/admin-key-setup";

export const dynamic = "force-dynamic";

/**
 * Второй ключ админки — код из Google Authenticator (TOTP в Supabase Auth).
 * Ключа ещё нет — показываем QR для подключения; новый QR при каждом
 * открытии страницы (неподтверждённые старые убираем). Ещё телефоны —
 * в «Команде».
 */
export default async function AdminMfa() {
  const { db, user, admin, aal2 } = await adminSession();
  if (!user || !admin) redirect("/admin/login");
  if (aal2) redirect("/admin");
  const ready = Boolean((await db.auth.mfa.listFactors()).data?.totp.length);
  const setup = ready ? null : await enrollAdminKey(db);
  return (
    <main className="adm-login">
      <div className="adm-login-card">
        <AdminBrand />
        {ready ? (
          <>
            <h1>Код из приложения</h1>
            <p className="muted">Откройте Google Authenticator и введите 6 цифр для Depter.</p>
            <AdminCodeForm factorId="any" />
          </>
        ) : setup ? (
          <>
            <h1>Подключите второй ключ</h1>
            <p className="muted">Без кода из приложения админка не откроется, даже если кто-то узнал пароль.</p>
            <AdminKeySetup setup={setup} />
          </>
        ) : (
          <p className="form-error" role="alert">
            Не удалось подготовить второй ключ. Обновите страницу.
          </p>
        )}
        <form action={adminLogout}>
          <button type="submit" className="text-button">
            Выйти
          </button>
        </form>
      </div>
    </main>
  );
}
