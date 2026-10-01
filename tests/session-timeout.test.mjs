import { test } from "node:test";
import assert from "node:assert/strict";
import { INACTIVITY_LIMIT_MS, inactivityExpired } from "../src/lib/session-timeout.ts";

test("inactivityExpired: only this session's mark older than the limit", () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const session = "5f1c2a9e-0000-4000-8000-000000000001";
  const at = (ms) => `${session}.${now - ms}`;
  // Нет метки (первый запрос после входа) — не выходим.
  assert.equal(inactivityExpired(undefined, session, now), false);
  // Активен недавно / ровно на границе — остаётся.
  assert.equal(inactivityExpired(at(5 * 60 * 1000), session, now), false);
  assert.equal(inactivityExpired(at(INACTIVITY_LIMIT_MS), session, now), false);
  // Больше 2 часов без действий — выход.
  assert.equal(inactivityExpired(at(INACTIVITY_LIMIT_MS + 1), session, now), true);
  // Метка от прошлой сессии (новый вход) — не выходим, метка перепишется.
  assert.equal(inactivityExpired(`other-session.${now - 10 * INACTIVITY_LIMIT_MS}`, session, now), false);
  // Битая метка — не выходим.
  assert.equal(inactivityExpired(`${session}.abc`, session, now), false);
  assert.equal(inactivityExpired("garbage", session, now), false);
});
