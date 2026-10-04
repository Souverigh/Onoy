"use server";
import { redirect } from "next/navigation";
import { createAnonClient, configured } from "@/lib/supabase/server";

/**
 * Заявка со страницы входа (без входа) → send_feedback; читает только
 * администратор Depter в /admin/feedback. Поле website скрыто от людей —
 * его заполняют только боты, им отвечаем «отправлено» и ничего не пишем.
 */
export async function sendFeedback(form: FormData) {
  const back = (state: string) => redirect(`/login?feedback=${state}#feedback`);
  if (String(form.get("website") ?? "")) back("sent");
  const name = String(form.get("name") ?? "").trim(),
    contact = String(form.get("contact") ?? "").trim(),
    message = String(form.get("message") ?? "").trim();
  if (!name || name.length > 120 || contact.length < 3 || contact.length > 120 || !message || message.length > 2000)
    back("invalid");
  if (!configured()) back("failed");
  const { error } = await createAnonClient().rpc("send_feedback", {
    p_name: name,
    p_contact: contact,
    p_message: message,
  });
  if (error) {
    console.warn("sendFeedback:", error.message);
    back(error.message.includes("too_many") ? "busy" : "failed");
  }
  back("sent");
}
