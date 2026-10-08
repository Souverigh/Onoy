import { brandIcon } from "@/lib/brand-icon";

export const dynamic = "force-static";

// Значок, который Android обрезает под форму своей темы (круг, капля, скруглённый квадрат).
export function GET() {
  return brandIcon(512, "maskable");
}
