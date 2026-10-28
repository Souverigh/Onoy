import type { ActionIcon } from "@/lib/business";

/** Значки главной: кнопок (ActionIcon) и «Первых шагов». */
export type IconName = ActionIcon | "camera" | "users";

/** Контуры значков; цвет — от текста кнопки (currentColor). */
const ICON_PATHS: Record<IconName, string[]> = {
  cart: ["M3 4h2.5l2 11h10.5l2-7.5H6.5", "M9 19h.01", "M17 19h.01"],
  box: ["m12 3 8 4.5v9L12 21l-8-4.5v-9z", "m4 7.5 8 4.5 8-4.5M12 12v9"],
  "cash-in": ["M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5", "M18.5 8v6M15.5 11h6"],
  card: ["M5 5.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z", "M3 10h18M7 15h4"],
  receipt: ["M6 3.5h12v17l-3-2-3 2-3-2-3 2z", "M9 9h6M9 12.5h6"],
  hanger: ["M12 7.5a2 2 0 1 1 2-2", "M12 7.5v1.5L3.5 15.5a1.2 1.2 0 0 0 .7 2.2h15.6a1.2 1.2 0 0 0 .7-2.2L12 9"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  camera: ["M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z", "M12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"],
  users: [
    "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z",
    "M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5",
    "M16 4.8a3.3 3.3 0 0 1 0 6.4M18.5 14.8c1.6.8 2.6 2.5 3 5.2",
  ],
};

export function Icon({ name, size = 26 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
