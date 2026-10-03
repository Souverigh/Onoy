// Миграции только добавляют: ни одна не должна удалять или переписывать данные
// клиентов (просьба пользователя 02.10.2026, правила — в CLAUDE.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = "supabase/migrations/";

// Миграции, которым пользователь явно разрешил менять данные: файл → что и почему.
const allowed = {
  // Заполняет копию email сотрудника из auth.users; данные клиентов не трогает.
  "20261002100000_member_email_sync.sql": ["update"],
};

const rules = [
  ["drop table", /^drop\s+table\b/i],
  ["drop schema", /^drop\s+schema\b/i],
  ["truncate", /^truncate\b/i],
  // drop как действие над таблицей (после имени таблицы или запятой), кроме ограничений.
  ["drop column", /^alter\s+table\s+(if\s+exists\s+)?(only\s+)?\S+\s+(.*,\s*)?drop\s+(?!constraint\b)/i],
  ["alter column type", /^alter\s+table\b.*\balter\s+(column\s+)?[a-z_"]+\s+(set\s+data\s+)?type\b/i],
  ["rename", /^alter\s+table\b.*\brename\b/i],
  ["delete", /^delete\s+from\b/i],
  ["update", /^update\b/i],
];

// Верхнеуровневые операторы: без комментариев и без тел функций ($$ … $$),
// где delete/update выполняются только по действию пользователя.
function statements(sql) {
  return sql
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "''")
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

test("migrations never drop or rewrite existing data", () => {
  const problems = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort())
    for (const s of statements(readFileSync(dir + f, "utf8")))
      for (const [name, re] of rules)
        if (re.test(s) && !allowed[f]?.includes(name))
          problems.push(`${f}: ${name}: ${s.slice(0, 120)}`);
  assert.deepEqual(problems, [], "Опасные операторы в миграциях (см. CLAUDE.md):\n" + problems.join("\n"));
});

test("safety check catches destructive statements", () => {
  const bad = [
    "drop table public.customers",
    "truncate public.payments",
    "alter table public.customers drop column phone",
    "alter table public.customers drop phone",
    "alter table public.payments alter column amount type integer",
    "alter table public.customers rename to clients",
    "delete from public.customers where true",
    "update public.payments set amount=0",
  ];
  for (const s of bad)
    assert.ok(rules.some(([, re]) => re.test(statements(s)[0])), s);
  const ok = [
    "alter table public.documents drop constraint documents_status_check",
    "alter table public.document_extractions alter column provider drop default",
    "drop view public.customer_balances",
    "create function f() returns void language sql as $$ delete from public.customers $$",
  ];
  for (const s of ok)
    assert.ok(statements(s).every((x) => !rules.some(([, re]) => re.test(x))), s);
});
