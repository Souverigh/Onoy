import { test } from "node:test";
import assert from "node:assert/strict";
import { subscriptionState } from "../src/lib/subscription.ts";

test("subscriptionState follows ТЗ §13: remind 5 days before, 7 grace days, then view-only", () => {
  const s = (paid, today) => subscriptionState(paid, null, false, today);
  assert.deepEqual(s(null, "2026-09-27"), { kind: "ok" });
  assert.deepEqual(s("2026-10-10", "2026-09-27"), { kind: "ok" });
  assert.deepEqual(s("2026-10-02", "2026-09-27"), { kind: "ending", paidUntil: "2026-10-02", daysLeft: 5 });
  assert.deepEqual(s("2026-09-27", "2026-09-27"), { kind: "ending", paidUntil: "2026-09-27", daysLeft: 0 });
  assert.deepEqual(s("2026-09-20", "2026-09-27"), { kind: "grace", paidUntil: "2026-09-20", graceUntil: "2026-09-27" });
  assert.deepEqual(s("2026-09-19", "2026-09-27"), { kind: "expired", paidUntil: "2026-09-19" });
  assert.deepEqual(subscriptionState("2026-12-31", "Нарушение", true, "2026-09-27"), { kind: "blocked", reason: "Нарушение" });
});
