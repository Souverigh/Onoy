import { brandIcon } from "@/lib/brand-icon";

// iPhone «На экран Домой»: сам скругляет углы — фон на весь квадрат.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return brandIcon(size.width, "square");
}
