import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { createAnonClient } from "@/lib/supabase/server";
import { phoneText } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { CatalogView, type CatalogItem } from "@/components/catalog-view";

type Catalog = { shop_name: string; shop_phone: string; currency: string; products: CatalogItem[] };

/** Каталог по ссылке (без входа): get_catalog — только название, единица и цена продажи. */
const loadCatalog = cache(async (token: string): Promise<Catalog | null> => {
  if (!/^[a-f0-9]{32}$/i.test(token)) return null;
  const { data, error } = await createAnonClient().rpc("get_catalog", { p_token: token.toLowerCase() });
  if (error) {
    console.error("catalog: get_catalog failed", { message: error.message });
    return null;
  }
  return (data as Catalog | null) ?? null;
});

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const catalog = await loadCatalog((await params).token);
  return {
    title: catalog ? `${catalog.shop_name} - каталог` : "Каталог",
    // Ссылка для своих клиентов — не для поиска.
    robots: { index: false, follow: false },
  };
}

/**
 * Каталог магазина для клиентов (просьба пользователя 22.10.2026): без входа,
 * с телефона. Ссылку выдаёт владелец на «Склад → Каталог для клиентов».
 */
export default async function CatalogPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9]{32}$/i.test(token)) notFound();
  const catalog = await loadCatalog(token);
  if (!catalog)
    return (
      <main className="client-page catalog-page">
        <section className="panel client-revoked">
          <h1>Каталог недоступен</h1>
          <p className="muted">Ссылка устарела или магазин выключил каталог. Попросите у продавца новую ссылку.</p>
        </section>
      </main>
    );
  const phone = catalog.shop_phone;
  const digits = phone ? normalizePhone(phone).replace(/\D/g, "") : "";
  return (
    <main className="client-page catalog-page">
      <header className="catalog-header">
        <div>
          <h1>{catalog.shop_name}</h1>
          <p className="muted">
            Каталог · {catalog.products.length} {goodsWord(catalog.products.length)}
          </p>
        </div>
        {digits && (
          <div className="catalog-contacts">
            <a className="button catalog-whatsapp" href={`https://wa.me/${digits}`} target="_blank" rel="noopener noreferrer">
              WhatsApp
            </a>
            <a className="button" href={`tel:+${digits}`} aria-label={`Позвонить: ${phoneText(phone)}`}>
              Позвонить
            </a>
          </div>
        )}
      </header>
      <CatalogView
        token={token}
        shopName={catalog.shop_name}
        shopPhone={phone}
        currency={catalog.currency}
        products={catalog.products}
      />
    </main>
  );
}

/** «1 товар», «3 товара», «5 товаров». */
function goodsWord(n: number) {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return "товаров";
  if (ones === 1) return "товар";
  if (ones >= 2 && ones <= 4) return "товара";
  return "товаров";
}
