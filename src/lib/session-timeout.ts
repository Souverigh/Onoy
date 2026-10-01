/**
 * Выход после бездействия (просьба пользователя 30.09.2026): нет запросов к
 * серверу 2 часа — сессия закрывается. Supabase сам так умеет только на
 * тарифе Pro, поэтому считает прокси (src/proxy.ts).
 */
export const INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000;

/** «<session_id>.<мс>» — когда эта сессия последний раз что-то открывала. */
export const SEEN_COOKIE = "depter_seen";

/** Ставится при выходе по бездействию — страница входа объясняет почему. */
export const EXPIRED_COOKIE = "depter_expired";

/** true — метка от этой же сессии и старше лимита. Чужая/битая метка — не истекла. */
export function inactivityExpired(seen: string | undefined, sessionId: string, now: number) {
  if (!seen) return false;
  const dot = seen.lastIndexOf(".");
  if (dot < 0 || seen.slice(0, dot) !== sessionId) return false;
  const at = Number(seen.slice(dot + 1));
  return Number.isFinite(at) && now - at > INACTIVITY_LIMIT_MS;
}
