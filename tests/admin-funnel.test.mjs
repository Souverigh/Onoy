import { test } from "node:test";
import assert from "node:assert/strict";
import { durationText, funnel, hasProblem, medianTime, reached, stuckAt } from "../src/lib/admin-funnel.ts";

const person = (over = {}) => ({
  created_at: "2026-10-01T10:00:00Z",
  confirmed_at: null,
  shop_created_at: null,
  first_customer_at: null,
  first_record_at: null,
  active_at: null,
  paid_at: null,
  ...over,
});
const confirmed = { confirmed_at: "2026-10-01T10:04:00Z" };
const shop = { ...confirmed, shop_created_at: "2026-10-01T10:15:00Z" };
const customers = { ...shop, first_customer_at: "2026-10-01T11:00:00Z" };

test("reached counts steps in a row; a later step without an earlier one does not count", () => {
  assert.equal(reached(person()), 1);
  assert.equal(reached(person(customers)), 4);
  assert.equal(reached(person({ ...shop, first_record_at: "2026-10-02T00:00:00Z" })), 3); // запись без клиента — шаг «клиенты» не пройден
});

test("funnel: counts, drops and the step where most people leave", () => {
  const rows = [person(), person(confirmed), person(shop), person(customers), person(customers), person(customers)];
  const { counts, drops, worst } = funnel(rows);
  assert.deepEqual(counts, [6, 5, 4, 3, 0, 0, 0]);
  assert.deepEqual(drops, [0, 1, 1, 1, 3, 0, 0]);
  assert.equal(worst, 4);
  assert.equal(stuckAt(rows, 4).length, 3);
  assert.equal(funnel([]).worst, null);
});

test("medianTime and durationText", () => {
  const rows = [person(confirmed), person({ confirmed_at: "2026-10-01T10:10:00Z" }), person({ confirmed_at: "2026-10-01T10:02:00Z" })];
  assert.equal(medianTime(rows, 0, 1), 4 * 60_000);
  assert.equal(medianTime(rows, 1, 2), null);
  assert.equal(durationText(4 * 60_000), "4 мин");
  assert.equal(durationText(3 * 3_600_000), "3 ч");
  assert.equal(durationText(30 * 3_600_000), "1 д 6 ч");
  assert.equal(durationText(5 * 86_400_000), "5 дней");
  assert.equal(durationText(21 * 86_400_000), "21 день");
  assert.equal(durationText(22 * 86_400_000), "22 дня");
});

test("problems: no customers after 2 days, quiet after active, trial ending with few records, waiting invite", () => {
  const now = new Date("2026-10-29T12:00:00Z");
  const today = "2026-10-29";
  assert.equal(hasProblem({ shop_created_at: "2026-10-26T00:00:00Z", customers: 0 }, "no_customers", now, today), true);
  assert.equal(hasProblem({ shop_created_at: "2026-10-28T20:00:00Z", customers: 0 }, "no_customers", now, today), false);
  assert.equal(hasProblem({ active_at: "2026-10-10T00:00:00Z", records_7d: 0 }, "quiet", now, today), true);
  assert.equal(hasProblem({ active_at: null, records_7d: 0 }, "quiet", now, today), false);
  assert.equal(hasProblem({ trial: true, paid_until: "2026-11-02", records_7d: 1 }, "trial_ending", now, today), true);
  assert.equal(hasProblem({ trial: true, paid_until: "2026-11-10", records_7d: 1 }, "trial_ending", now, today), false);
  assert.equal(hasProblem({ trial: false, paid_until: "2026-11-02", records_7d: 0 }, "trial_ending", now, today), false);
  assert.equal(hasProblem({ pending_invites: 1 }, "invite", now, today), true);
});
