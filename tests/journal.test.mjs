import { test } from "node:test";
import assert from "node:assert/strict";
import { journalHref, parseJournal, periodBounds, periodButtonLabel, periodDays, periodText } from "../src/lib/journal-filters.ts";

test("periodButtonLabel: this and last month by name, January rolls back a year; other periods keep their label", () => {
  assert.equal(periodButtonLabel({ period: "month" }, "2026-10-28"), "Октябрь 2026");
  assert.equal(periodButtonLabel({ period: "prev_month" }, "2026-01-15"), "Декабрь 2025");
  assert.equal(periodButtonLabel({ period: "week" }, "2026-10-28"), null);
});

test("parseJournal: defaults to this month, newest first; garbage and foreign author ignored", () => {
  assert.deepEqual(parseJournal({}), {
    period: "month", from: "", to: "", q: "", status: "all", by: "", sort: "date_desc", page: 1,
  });
  const f = parseJournal({ period: "nope", status: "x", sort: "y", page: "-3", by: "11111111-1111-4111-8111-111111111111", q: "  Айбек   ака " });
  assert.equal(f.period, "month");
  assert.equal(f.status, "all");
  assert.equal(f.sort, "date_desc");
  assert.equal(f.page, 1);
  assert.equal(f.by, "", "author filter only for the owner");
  assert.equal(f.q, "Айбек ака");
  assert.equal(parseJournal({ by: "11111111-1111-4111-8111-111111111111" }, { allowBy: true }).by, "11111111-1111-4111-8111-111111111111");
  // Свой период без дат — снова месяц; кривая дата — отброшена.
  assert.equal(parseJournal({ period: "custom" }).period, "month");
  assert.deepEqual(
    [parseJournal({ period: "custom", from: "2026-02-30", to: "2026-03-05" }).from, parseJournal({ period: "custom", from: "2026-02-30", to: "2026-03-05" }).to],
    ["", "2026-03-05"],
  );
});

test("periodDays: Bishkek days for each preset; custom range swaps reversed dates", () => {
  const today = "2026-10-17"; // суббота
  assert.deepEqual(periodDays({ period: "today" }, today), { from: today, to: today });
  assert.deepEqual(periodDays({ period: "yesterday" }, today), { from: "2026-10-16", to: "2026-10-16" });
  assert.deepEqual(periodDays({ period: "week" }, today), { from: "2026-10-12", to: today });
  assert.deepEqual(periodDays({ period: "month" }, today), { from: "2026-10-01", to: today });
  assert.deepEqual(periodDays({ period: "prev_month" }, "2026-03-10"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodDays({ period: "prev_month" }, "2026-01-05"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(periodDays({ period: "all" }, today), { from: null, to: null });
  assert.deepEqual(periodDays({ period: "custom", from: "2026-10-10", to: "2026-10-01" }, today), { from: "2026-10-01", to: "2026-10-10" });
  assert.deepEqual(periodDays({ period: "custom", from: "", to: "2026-10-01" }, today), { from: null, to: "2026-10-01" });
});

test("periodBounds: from the start of the first day to the start of the day after the last, UTC+6", () => {
  assert.deepEqual(periodBounds({ from: "2026-10-01", to: "2026-10-17" }), {
    gte: "2026-09-30T18:00:00.000Z",
    lt: "2026-10-17T18:00:00.000Z",
  });
  assert.deepEqual(periodBounds({ from: null, to: null }), { gte: null, lt: null });
});

test("journalHref: only non-default filters in the link; changing a filter resets the page", () => {
  const f = parseJournal({ period: "week", q: "Айбек", page: "3" });
  assert.equal(journalHref("/sales", f), "/sales?period=week&q=%D0%90%D0%B9%D0%B1%D0%B5%D0%BA");
  assert.equal(journalHref("/sales", f, { page: 4 }), "/sales?period=week&q=%D0%90%D0%B9%D0%B1%D0%B5%D0%BA&page=4");
  assert.equal(journalHref("/sales", parseJournal({})), "/sales");
  assert.equal(
    journalHref("/purchases", parseJournal({}), { period: "custom", from: "2026-10-01", to: "2026-10-05", sort: "sum_desc" }),
    "/purchases?period=custom&from=2026-10-01&to=2026-10-05&sort=sum_desc",
  );
});

test("periodText: readable period above the totals", () => {
  assert.equal(periodText({ from: null, to: null }), "за всё время");
  assert.equal(periodText({ from: "2026-10-17", to: "2026-10-17" }), "за 17 октября 2026 г.");
  assert.equal(periodText({ from: "2026-10-01", to: "2026-10-17" }), "с 1 октября 2026 г. по 17 октября 2026 г.");
});
