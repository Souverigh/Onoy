import { test } from "node:test";
import assert from "node:assert/strict";
import { searchParties } from "../src/lib/party-search.ts";

const customers = [
  { id: "aibek", name: "Айбек", phone: "0555 12-34-56" },
  { id: "asan", name: "Асан ака", phone: "+996 700 111 222" },
  { id: "timur", name: "Тимур аке", phone: "", aliases: ["Тимур Электрик"] },
];

test("«555 12» finds Aibek by phone however it was written", () => {
  assert.deepEqual(searchParties("555 12", customers).map((c) => c.id), ["aibek"]);
  assert.deepEqual(searchParties("700111", customers).map((c) => c.id), ["asan"]);
});

test("name search ignores case and finds by alias", () => {
  assert.deepEqual(searchParties("айб", customers).map((c) => c.id), ["aibek"]);
  assert.deepEqual(searchParties("электрик", customers).map((c) => c.id), ["timur"]);
  assert.equal(searchParties("", customers).length, 3);
  assert.equal(searchParties("нет такого", customers).length, 0);
});
