import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { configured, createClient } from "./supabase/server";

/**
 * Сессия на страницах входа в админку: кто вошёл, админ ли он (private.
 * platform_admins) и введён ли второй ключ (aal2 — код из приложения).
 */
export const adminSession = cache(async () => {
  if (!configured()) notFound();
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { db, user: null, admin: false, aal2: false };
  const admin = (await db.rpc("am_i_platform_admin")).data === true;
  return {
    db,
    user: { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null },
    admin,
    aal2: claims.aal === "aal2",
  };
});

/**
 * Новый телефон со вторым ключом: QR для Google Authenticator. Старые
 * неподтверждённые (QR открыли, код не ввели) убираем; имя — «Телефон N».
 */
export async function enrollAdminKey(db: Awaited<ReturnType<typeof createClient>>) {
  const factors = (await db.auth.mfa.listFactors()).data?.all ?? [];
  for (const f of factors)
    if (f.factor_type === "totp" && f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
  const names = new Set(factors.filter((f) => f.status === "verified").map((f) => f.friendly_name));
  let n = 1;
  while (names.has(`Телефон ${n}`)) n++;
  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: `Телефон ${n}`, issuer: "Depter" });
  if (!data) {
    console.warn("admin mfa enroll:", error?.message);
    return null;
  }
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Страницы админки. Не вошли — вход на /admin/login; вошли не админом —
 * 404 (не выдаём, что админка есть); админ без второго ключа — /admin/mfa.
 * Сама база тоже проверяет: admin_* функции требуют aal2.
 */
export async function requirePlatformAdmin() {
  const { db, user, admin, aal2 } = await adminSession();
  if (!user) redirect("/admin/login");
  if (!admin) notFound();
  if (!aal2) redirect("/admin/mfa");
  return { db, user };
}
