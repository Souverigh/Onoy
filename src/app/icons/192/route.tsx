import { brandIcon } from "@/lib/brand-icon";

export const dynamic = "force-static";

// Android требует для установки значки 192 и 512 px (src/app/manifest.ts).
export function GET() {
  return brandIcon(192, "round");
}
