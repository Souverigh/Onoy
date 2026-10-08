import { brandIcon } from "@/lib/brand-icon";

// Фавикон и значок приложения 512 px (src/app/manifest.ts).
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return brandIcon(size.width, "round");
}
