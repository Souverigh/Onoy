/** Заявка со страницы входа (admin_feedback) — с найденным аккаунтом Depter. */
export type FeedbackRow = {
  id: number;
  name: string;
  contact: string;
  message: string;
  created_at: string;
  status: FeedbackStatus;
  status_at: string | null;
  next_contact: string | null;
  last_note: string | null;
  match_org: string | null;
  match_user: string | null;
  match_name: string | null;
};

export type FeedbackStatus = "new" | "contacted" | "done";

/** Статусы — в порядке счётчиков и кнопок. */
export const FEEDBACK_STATUSES: { key: FeedbackStatus; label: string; chip: string; button: string; tone: "bad" | "warn" | "ok" }[] = [
  { key: "new", label: "Новая", chip: "Новые", button: "Новая", tone: "bad" },
  { key: "contacted", label: "Написали", chip: "Написали, ждём", button: "Написали, ждём ответа", tone: "warn" },
  { key: "done", label: "Готово", chip: "Готово", button: "Готово", tone: "ok" },
];
export const isFeedbackStatus = (v: unknown): v is FeedbackStatus => FEEDBACK_STATUSES.some((s) => s.key === v);

export const isEmail = (contact: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim());

/** Пора ответить: дата из заметки подошла, а заявка ещё не закрыта. */
export const feedbackDue = (f: FeedbackRow, today: string) => Boolean(f.next_contact && f.next_contact <= today && f.status !== "done");

/** Первое сообщение в WhatsApp тому, кто оставил заявку. */
export const feedbackWaText = (name: string) =>
  `Здравствуйте, ${name}! Это Depter, вы оставили заявку на сайте. Чем можем помочь?`;
