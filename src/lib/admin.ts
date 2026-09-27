import "server-only";
import { notFound } from "next/navigation";
import { getUserContext } from "./context";

/**
 * Администратор платформы Depter (private.platform_admins). Остальным
 * админка отвечает 404 — не выдаём, что она есть. Сама база тоже проверяет
 * (admin_only в каждом admin_* RPC).
 */
export async function requirePlatformAdmin() {
  const { db, user } = await getUserContext();
  const { data } = await db.rpc("am_i_platform_admin");
  if (data !== true) notFound();
  return { db, user };
}
