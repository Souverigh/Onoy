// Номер миграции — цифры в начале имени файла (20261021120000_….sql).
// Общий для проверки перед выкладкой (check-migrations.mjs) и теста
// tests/migration-safety.test.mjs.
import { readdirSync, readFileSync } from "node:fs";

export const MIGRATIONS_DIR = "supabase/migrations/";

/** Последняя миграция в коде: { file, version }. */
export function latestMigration(dir = MIGRATIONS_DIR) {
  const file = readdirSync(dir)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f))
    .sort()
    .at(-1);
  return file ? { file, version: file.slice(0, 14), sql: readFileSync(dir + file, "utf8") } : null;
}

/** Номер, который миграция ставит в public.app_schema_version(), или null. */
export function declaredVersion(sql) {
  const m = sql.match(/function\s+public\.app_schema_version\s*\(\s*\)[\s\S]*?\$\$\s*select\s+'(\d{14})'\s*\$\$/i);
  return m ? m[1] : null;
}
