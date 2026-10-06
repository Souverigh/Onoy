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

test("supplier name in latin letters finds the cyrillic one (Horoz → Короз электрик)", () => {
  const suppliers = [
    { id: "horoz", name: "Короз электрик" },
    { id: "other", name: "Электрик сервис" },
  ];
  const [top] = bestMatches("Horoz Electric Asia", suppliers, 3);
  assert.equal(top.candidate.id, "horoz");
  assert.ok(top.score >= 0.85, `score ${top.score}`);
});

test("a shared «ака» or «эже» does not make names similar", () => {
  const customers = [{ id: "bakyt", name: "Бакыт ака" }];
  assert.equal(bestMatches("Канат ака", customers, 3, 0.45).length, 0);
  assert.equal(bestMatches("Айгуль эже", [{ id: "a", name: "Нургуль эже" }], 3, 0.6).length, 0);
  assert.equal(bestMatches("Бакыт", customers, 3)[0].candidate.id, "bakyt");
});

test("one shared first name is not enough for a sure match", () => {
  const [top] = bestMatches("Айбек Асанов", [{ id: "1", name: "Айбек" }], 3, 0);
  assert.ok(top.score < 0.85, `score ${top.score}`);
});
