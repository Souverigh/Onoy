// Единый стиль (просьба пользователя 21.10.2026): цвета — токенами из :root
// в src/app/globals.css, правила — docs/ui.md. Старые «голые» цвета пока
// остались; этот тест не даёт добавить новые. Убрали несколько — уменьшите
// BASELINE до нового числа.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const BASELINE = 226;

test("globals.css: no new hard-coded colors outside :root tokens", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rest = css.slice(css.indexOf("}", css.indexOf(":root {")));
  const found = rest.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
  assert.ok(
    found.length <= BASELINE,
    `В globals.css ${found.length} цветов кодом (было ${BASELINE}). Новые цвета - через токены в :root ` +
      `(var(--green-soft), var(--danger-ink)…), список - docs/ui.md.`,
  );
});
