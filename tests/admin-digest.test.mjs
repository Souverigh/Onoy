import { test } from "node:test";
import assert from "node:assert/strict";
import { digestText } from "../src/lib/admin-funnel.ts";

const now = new Date("2026-10-30T03:00:00Z"); // 9:00 в Бишкеке
const today = "2026-10-30";
const hoursAgo = (h) => new Date(now.getTime() - h * 3_600_000).toISOString();
const funnelRow = (over) => ({
  user_id: "u1",
  org_id: null,
  email: "x@example.com",
  shop_name: null,
  created_at: hoursAgo(30),
  confirmed_at: null,
  shop_created_at: null,
  first_customer_at: null,
  first_record_at: null,
  active_at: null,
  paid_at: null,
  customers: 0,
  records_7d: 0,
  trial: false,
  paid_until: null,
  pending_invites: 0,
  ...over,
});

test("digest: day totals, contacts due by notes, stuck people, attention; links to the admin", () => {
  const funnel = [
    funnelRow({ user_id: "u1", email: "new@example.com", created_at: hoursAgo(5) }), // свежая регистрация, ещё не застрял
    funnelRow({ user_id: "u2", email: "late@example.com", created_at: hoursAgo(40) }), // не подтвердил больше суток
    funnelRow({ user_id: "u3", org_id: "o3", shop_name: "Тулпар", created_at: hoursAgo(90), confirmed_at: hoursAgo(89), shop_created_at: hoursAgo(80) }),
    funnelRow({ user_id: "u4", org_id: "o4", shop_name: "Береке", created_at: hoursAgo(900), active_at: hoursAgo(500), records_7d: 0 }),
    funnelRow({ user_id: "u5", email: "old@example.com", created_at: hoursAgo(24 * 30) }), // давно — уже не «застрял»
  ];
  const people = [
    { kind: "shop", org_id: "o3", user_id: "u3", name: "Тулпар", next_contact: "2026-10-30", last_note: "Перезвонить <после обеда>", records_7d: 0 },
    { kind: "shop", org_id: "o9", user_id: "u9", name: "Нур", next_contact: "2026-11-02", last_note: "позже", records_7d: 5 },
  ];
  const text = digestText(people, funnel, now, today, "https://www.depter.kg");
  assert.match(text, /30 октября/);
  assert.match(text, /регистраций 1 · магазинов 0/);
  assert.match(text, /Активных магазинов сейчас: 1/);
  assert.match(text, /Связаться сегодня<\/b> \(1\)\n• <a href="https:\/\/www.depter.kg\/admin\/shop\/o3">Тулпар<\/a> — Перезвонить &lt;после обеда&gt;/);
  assert.match(text, /late@example.com<\/a> — не подтвердил почту/);
  assert.match(text, /Тулпар<\/a> — магазин без клиентов/);
  assert.ok(!text.includes("new@example.com") && !text.includes("old@example.com"));
  assert.match(text, /Береке<\/a> — затих после активной недели/);
  assert.ok(!text.includes("Всё спокойно"));
});

test("digest: requests without an answer and request contacts due by notes", () => {
  const feedback = [
    { id: 7, name: "Айбек", contact: "+996 555 123 456", message: "Хочу подключить магазин", created_at: hoursAgo(3), status: "new", next_contact: null },
    { id: 8, name: "Бакыт", contact: "+996 772 44 11 00", message: "Два магазина?", created_at: hoursAgo(50), status: "contacted", next_contact: "2026-10-30", last_note: "Ждёт цену" },
    { id: 9, name: "Эрлан", contact: "e@x.kg", message: "Старая", created_at: hoursAgo(24 * 20), status: "new", next_contact: null },
    { id: 10, name: "Гуля", contact: "g@x.kg", message: "Готово", created_at: hoursAgo(10), status: "done", next_contact: "2026-10-29" },
  ];
  const text = digestText([], [], now, today, "https://www.depter.kg", feedback);
  assert.match(text, /Заявки без ответа<\/b> \(1\)\n• <a href="https:\/\/www.depter.kg\/admin\/feedback\/7">Айбек<\/a> — \+996 555 123 456 · Хочу подключить магазин/);
  assert.match(text, /Связаться сегодня<\/b> \(1\)\n• <a href="https:\/\/www.depter.kg\/admin\/feedback\/8">Заявка: Бакыт<\/a> — Ждёт цену/);
  assert.ok(!text.includes("Эрлан") && !text.includes("Гуля")); // старая и закрытая — не напоминаем
});

test("digest: a quiet morning says so", () => {
  const text = digestText([], [], now, today, "https://www.depter.kg");
  assert.match(text, /Всё спокойно/);
  assert.match(text, /\/admin\/funnel">Воронка/);
});
