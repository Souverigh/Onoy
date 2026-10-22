// Перед выкладкой на рабочий сайт: все миграции из кода уже в базе?
// (просьба пользователя 21.10.2026; правило — docs/release-checklist.md).
// Код рассчитан на то, что его миграции применены. Если нет — сборка падает,
// и на сайте остаётся прошлая версия.
//
// Работает только при сборке production на Vercel (VERCEL_ENV=production):
// локальная сборка и preview базу не спрашивают. Только чтение: вызывает
// public.app_schema_version() публичным ключом — тем же, что у сайта.
// Обойти один раз (база недоступна, а выложить нужно срочно): переменная
// SKIP_MIGRATION_CHECK=1 в Vercel на эту сборку.
import { latestMigration } from "./migration-version.mjs";

if (process.env.VERCEL_ENV !== "production") {
  console.log("check-migrations: не production-сборка Vercel - базу не проверяем.");
  process.exit(0);
}
if (process.env.SKIP_MIGRATION_CHECK === "1") {
  console.warn("check-migrations: ПРОПУЩЕНО (SKIP_MIGRATION_CHECK=1). Убедитесь, что миграции применены.");
  process.exit(0);
}

const latest = latestMigration();
if (!latest) process.exit(0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const fail = (text) => {
  console.error(`\ncheck-migrations: ВЫКЛАДКА ОСТАНОВЛЕНА.\n${text}\n`);
  process.exit(1);
};
if (!url || !key) fail("Нет NEXT_PUBLIC_SUPABASE_URL или NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY - не с чем сверить базу.");

let applied = null;
try {
  const res = await fetch(`${url}/rest/v1/rpc/app_schema_version`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404)
    fail(
      `В базе нет функции app_schema_version - не применена миграция 20261021120000_app_schema_version.sql ` +
        `(и, возможно, другие). Сделайте бэкап, примените миграции, затем повторите выкладку (Redeploy).`,
    );
  if (!res.ok) fail(`База ответила ${res.status}: ${(await res.text()).slice(0, 300)}`);
  applied = await res.json();
} catch (error) {
  fail(`Не удалось спросить базу: ${error instanceof Error ? error.message : error}. Повторите выкладку позже.`);
}

if (typeof applied !== "string" || !/^\d{14}$/.test(applied)) fail(`Непонятный ответ базы: ${JSON.stringify(applied)}`);
if (applied < latest.version)
  fail(
    `В коде есть миграция новее, чем в базе.\n` +
      `  База: ${applied}\n  Код:  ${latest.file}\n` +
      `Сделайте бэкап базы, примените все миграции новее ${applied} из supabase/migrations/, затем Redeploy.`,
  );
console.log(`check-migrations: база ${applied}, код ${latest.version} - можно выкладывать.`);
