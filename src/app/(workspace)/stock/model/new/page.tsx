import { redirect } from "next/navigation";

/**
 * Товар с размерами и цветами заводят в общей форме «Новый товар» (решение
 * пользователя 31.10.2026). Старые ссылки сюда ведут туда же.
 */
export default function NewModelPage() {
  redirect("/stock/new");
}
