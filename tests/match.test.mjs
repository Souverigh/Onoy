import { test } from "node:test";
import assert from "node:assert/strict";
import { similarity, bestMatches } from "../src/lib/match.ts";

test("similarity is 1 for identical names ignoring case and punctuation", () => {
  assert.equal(similarity("Асан", "асан"), 1);
  assert.equal(similarity("Horoz Electric", "horoz electric"), 1);
  assert.equal(similarity("ООО «Ромашка»", "ооо ромашка"), 1);
});

test("similarity is high for близкие variants and low for unrelated names", () => {
  assert.ok(similarity("Медербек", "Медербек уулу") > 0.5);
  assert.ok(similarity("Асан", "Максат") < 0.3);
});

test("bestMatches ranks by name and learned aliases, respects limit and threshold", () => {
  const candidates = [
    { id: "1", name: "Асан Тумарбеков" },
    { id: "2", name: "Максат", aliases: ["максат ака"] },
    { id: "3", name: "Совершенно другое имя" },
  ];
  const matches = bestMatches("Асан", candidates, 2, 0);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].candidate.id, "1");

  const aliasMatches = bestMatches("максат ака", candidates, 3);
  assert.equal(aliasMatches[0].candidate.id, "2");

  const noMatches = bestMatches("Зовсем неизвестное", candidates, 3, 0.9);
  assert.equal(noMatches.length, 0);
});
