import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHalves } from "../src/lib/adre/halves.ts";

const line = (n, name, qty, price, sum = String(Number(qty) * Number(price))) => ({
  n,
  name_raw: name,
  qty,
  unit: "шт",
  price,
  sum,
  confidence: 0.9,
});

test("mergeHalves: numbered rows — overlap removed by the paper number, the row that adds up wins", () => {
  const upper = [line(1, "Щит -4", "10", "216"), line(2, "Щит -8", "10", "326"), line(3, "Хомут", "5", "40", "250")];
  const lower = [line(3, "Хомут", "5", "50"), line(4, "Лампа", "2", "100")];
  const merged = mergeHalves(upper, lower);
  assert.deepEqual(merged.map((l) => [l.n, l.name_raw, l.price]), [
    [1, "Щит -4", "216"],
    [2, "Щит -8", "326"],
    [3, "Хомут", "50"],
    [4, "Лампа", "100"],
  ]);
});

test("mergeHalves: no numbers on paper — identical rows at the seam are taken once", () => {
  const upper = [line(0, "А", "1", "10"), line(0, "Б", "2", "20"), line(0, "В", "3", "30")];
  const lower = [line(0, "Б", "2", "20"), line(0, "В", "3", "30"), line(0, "Г", "4", "40")];
  assert.deepEqual(
    mergeHalves(upper, lower).map((l) => [l.n, l.name_raw]),
    [
      [1, "А"],
      [2, "Б"],
      [3, "В"],
      [4, "Г"],
    ],
  );
  // Без повтора на стыке — просто подряд.
  assert.equal(mergeHalves(upper.slice(0, 1), lower.slice(2)).length, 2);
});
