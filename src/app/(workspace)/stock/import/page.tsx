import Link from "next/link";
import { StockImport } from "@/components/stock-import";

export default function StockImportPage() {
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
            Прайс или выгрузка из 1С: название, код, единица, цена, остаток — колонки найдём сами.{" "}
            <a className="text-button" href="/stock/import/template">
              Скачать шаблон
            </a>
          </p>
        </div>
      </div>
      <section className="panel">
        <StockImport />
      </section>
    </>
  );
}
