import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { phoneText } from "@/lib/format";
import { normalizePhone } from "@/lib/contacts";
import { CatalogView } from "@/components/catalog-view";
import { parseAxes } from "@/lib/product-model";
import { productPhotoUrl, productThumbUrl } from "@/lib/product-photo";
import { loadCatalog } from "@/lib/catalog-cache";

// Страница собирается один раз на ссылку и раздаётся из кеша (CDN), без
// запросов к базе на каждый заход. Изменили товары — кеш сбрасывается сразу
// (refreshCatalog); на всякий случай — не реже раза в час (CATALOG_REVALIDATE).
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

const tokenPattern = /^[a-f0-9]{32}$/;

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const catalog = tokenPattern.test(token) ? await loadCatalog(token) : null;
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
  if (!tokenPattern.test(token)) notFound();
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
        products={catalog.products.map((p) => ({
          ...p,
          photo: productPhotoUrl(p.photo),
          thumb: productThumbUrl(p.photo),
          category: p.category ?? null,
          model: p.model ?? null,
          variant: p.variant ?? null,
        }))}
        categories={(catalog.categories ?? []).map((c) => ({ id: c.id, name: c.name, parent_id: c.parent }))}
        models={(catalog.models ?? []).map((m) => ({ id: m.id, name: m.name, axes: parseAxes(m.axes) }))}
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
