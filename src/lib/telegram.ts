import "server-only";
import { after } from "next/server";

/**
 * Уведомления команде Depter в Telegram: регистрации, новые магазины,
 * заявки, утренняя сводка. TELEGRAM_BOT_TOKEN — от @BotFather,
 * TELEGRAM_CHAT_ID — чат или группа команды (несколько — через запятую).
 * Не заданы — ничего не шлём и ничего не ломаем.
 */
export const telegramConfigured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

/** Текст для parse_mode=HTML. */
export const tg = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Ссылка на рабочий сайт (в сообщениях — всегда на depter.kg, не на превью). */
export const siteUrl = (path: string) => `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || "www.depter.kg"}${path}`;

const LIMIT = 4000;

/** Отправить сообщение во все чаты команды; true — дошло хотя бы в один. */
export async function sendTelegram(html: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chats = (process.env.TELEGRAM_CHAT_ID ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  if (!token || !chats.length) return false;
  // Лимит Telegram — 4096 символов; режем по строкам, чтобы не порвать тег.
  let text = html;
  if (text.length > LIMIT) text = `${text.slice(0, text.lastIndexOf("\n", LIMIT - 20))}\n…`;
  let sent = false;
  for (const chat of chats) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) sent = true;
      else console.warn("telegram:", res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.warn("telegram:", e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Уведомить команду после ответа: регистрация и вход не ждут Telegram. */
export function notifyTeam(html: string) {
  if (!telegramConfigured()) return;
  after(async () => {
    await sendTelegram(html);
  });
}

/** Чаты, где боту недавно писали, — чтобы найти TELEGRAM_CHAT_ID без кода. */
export async function recentTelegramChats(): Promise<{ id: string; title: string }[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return [];
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates`, { signal: AbortSignal.timeout(5000), cache: "no-store" });
    type Chat = { id: number; title?: string; first_name?: string; type: string };
    const data = (await res.json()) as { result?: { message?: { chat: Chat }; my_chat_member?: { chat: Chat } }[] };
    const chats = new Map<string, string>();
    for (const u of data.result ?? []) {
      const chat = u.message?.chat ?? u.my_chat_member?.chat;
      if (chat) chats.set(String(chat.id), chat.title ?? chat.first_name ?? chat.type);
    }
    return [...chats].map(([id, title]) => ({ id, title }));
  } catch {
    return [];
  }
}
