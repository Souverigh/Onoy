/** PostgreSQL numeric values are exposed as text; never coerce stored amounts to JS Number. */
function decimal(value: string | number) {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error("Invalid decimal value");
  const [, sign, whole, fraction = ""] = match;
  const grouped = new Intl.NumberFormat("ru-RU").format(BigInt(whole));
  const tail = fraction.replace(/0+$/, "");
  return sign + grouped + (tail ? "," + tail : "");
}
export const money = (value: number | string) => decimal(value) + " сом";
export const quantity = (value: number | string) => decimal(value);
export function decimalLessThan(a: string, b: string) {
  const scale = Math.max(
    (a.split(".")[1] ?? "").length,
    (b.split(".")[1] ?? "").length,
  );
  const integer = (v: string) => {
    const negative = v.startsWith("-");
    const [whole, part = ""] = v.replace(/^-/, "").split(".");
    return (negative ? -1n : 1n) * BigInt(whole + part.padEnd(scale, "0"));
  };
  return integer(a) < integer(b);
}
