import Link from "next/link";
import { StockImport } from "@/components/stock-import";
import { requireOwner } from "@/lib/context";

// Прайс на 2000 строк пишется частями по 500 — даём серверу время (по
// умолчанию запрос обрывается раньше, и загрузка остаётся наполовину).
export const maxDuration = 60;

/** Одна загрузка меняет цены и остатки всего склада — только владелец. */
export default async function StockImportPage() {
  const { currency } = await requireOwner();
  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СКЛАД</span>
          <h1>Товары из Excel</h1>
          <p className="muted">
            Прайс или выгрузка из 1С: название, код, единица, цена, остаток - колонки найдём сами.{" "}
            <a className="text-button" href="/stock/import/template">
              Скачать шаблон
            </a>
          </p>
        </div>
      </div>
      <section className="panel">
        <StockImport shopCurrency={currency} />
      </section>
    </>
  );
}
