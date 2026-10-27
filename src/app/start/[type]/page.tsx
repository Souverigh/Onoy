import { notFound, redirect } from "next/navigation";
import { businessBySlug } from "@/lib/business";

/**
 * Вход под вид бизнеса: depter.kg/start/prokat — регистрация, после которой
 * магазин сразу создаётся «Прокатом одежды» (разделы, кнопки и слова под него).
 */
export default async function StartPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const business = businessBySlug(type);
  if (!business) notFound();
  redirect(`/signup?type=${business}`);
}
