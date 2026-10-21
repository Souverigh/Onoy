import { money } from "@/lib/format";
import type { Currency } from "@/lib/currency";

/** Суммы в других валютах под основной суммой ячейки: «+ 500 $». */
export function ForeignSums({
  items,
  pick,
}: {
  items: ({ currency: Currency } & Record<"sold" | "collected", number>)[];
  pick: "sold" | "collected";
}) {
  const shown = items.filter((f) => Math.abs(f[pick]) >= 0.005);
  if (!shown.length) return null;
  return (
    <>
      {shown.map((f) => (
        <small key={f.currency} className="muted foreign-sum">
          + {money(f[pick], f.currency)}
        </small>
      ))}
    </>
  );
}
