import { money } from "@/lib/format";
import { priceMarkup } from "@/lib/stock";

/**
 * «Наценка: +450 сом с каждой штуки (45%)» под ценами товара (макет
 * 31.10.2026). Закупка в другой валюте — не сравнить, строки нет.
 */
export function PriceMarkup({
  sale,
  purchase,
  purchaseCurrency,
  currency,
  unit,
}: {
  sale: string;
  purchase: string;
  purchaseCurrency: string;
  currency: string;
  unit: string;
}) {
  const markup = purchaseCurrency === currency ? priceMarkup(sale, purchase) : null;
  if (!markup) return null;
  const per = unit === "шт" ? "с каждой штуки" : `за 1 ${unit}`;
  if (markup.amount < 0)
    return (
      <p className="price-markup loss" role="status">
        Продажа дешевле закупки: <b>−{money(Math.abs(markup.amount), currency)}</b> {per}
      </p>
    );
  return (
    <p className="price-markup" role="status">
      Наценка: <b>+{money(markup.amount, currency)}</b> {per} ({markup.percent}%)
    </p>
  );
}
