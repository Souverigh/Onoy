import Link from "next/link";
import { headers } from "next/headers";
import { requireOwner } from "@/lib/context";
import { CopyButton } from "@/components/copy-button";
import { ConfirmButton } from "@/components/confirm-button";
import { Submit } from "@/components/submit";
import { CatalogProducts, type CatalogProductRow } from "@/components/catalog-products";
import { productThumbUrl } from "@/lib/product-photo";
import { closeCatalog, openCatalog } from "./actions";

/**
 * Каталог для клиентов (просьба пользователя 22.10.2026): ссылка без входа
 * с названиями и ценами продажи — владелец включает, отправляет клиентам,
 * выбирает товары. Наличия в каталоге нет.
 */
export default async function CatalogSettings({
  searchParams,
}: {
  searchParams: Promise<{ opened?: string; closed?: string; saved?: string; error?: string }>;
}) {
  const { db, organizationId, organizationName, currency } = await requireOwner();
  const { opened, closed, saved, error } = await searchParams;
  const [link, products] = await Promise.all([
    db.from("catalog_links").select("token,revoked_at").eq("organization_id", organizationId).maybeSingle(),
    db
      .from("products")
      .select("id,name,sku,unit,sale_price,catalog_hidden,photo_path")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("name")
      .range(0, 4999),
  ]);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const active = link.data && !link.data.revoked_at ? (link.data.token as string) : null;
  const url = active ? `${origin}/catalog/${active}` : null;
  const shareText = url ? `Каталог ${organizationName}: цены на товары. Выберите нужное и нажмите «Отправить заказ» - заказ придёт нам сразу.\n${url}` : "";

  return (
    <>
      <Link className="back-link" href="/stock">
        ← Склад
      </Link>
      <div className="page-heading">
        <div>
          <h1>Каталог для клиентов</h1>
          <p className="muted">
            Одна ссылка: клиенты открывают её с телефона без входа, ищут товар, видят цену и отправляют заказ
            кнопкой «Отправить заказ» - он приходит в «Заказы».
          </p>
        </div>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error === "save" ? "Не удалось сохранить список товаров. Попробуйте ещё раз." : "Не удалось изменить ссылку. Попробуйте ещё раз."}
        </p>
      )}
      {(opened || closed || saved) && (
        <p className="notice success" role="status">
          {opened ? "Каталог включён - отправьте ссылку клиентам." : closed ? "Каталог выключен - ссылка больше не открывается." : "Сохранено."}
        </p>
      )}

      <section className="panel catalog-link-panel">
        {url ? (
          <>
            <div className="section-title">
              <h2>Ссылка на каталог</h2>
              <span className="tag green">включён</span>
            </div>
            <p className="catalog-link-url">{url}</p>
            <div className="catalog-link-actions">
              <CopyButton text={url} className="button primary" />
              <a className="button" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">
                Отправить в WhatsApp
              </a>
              <a className="button" href={url} target="_blank" rel="noopener noreferrer">
                Открыть как клиент
              </a>
              <form action={closeCatalog}>
                <ConfirmButton
                  className="button danger-outline"
                  danger={false}
                  message="Выключить каталог?"
                  text="Ссылка перестанет открываться у всех, кому вы её отправили. Включить можно снова - будет новая ссылка."
                  confirmLabel="Выключить"
                >
                  Выключить
                </ConfirmButton>
              </form>
            </div>
          </>
        ) : (
          <>
            <h2>Каталог выключен</h2>
            <p className="muted">
              Включите - появится ссылка, которую можно отправить клиентам в WhatsApp, поставить в статус или
              напечатать на кассе.
            </p>
            <form action={openCatalog}>
              <Submit>Включить каталог</Submit>
            </form>
          </>
        )}
      </section>

      <section className="panel">
        <CatalogProducts
          products={((products.data ?? []) as (Omit<CatalogProductRow, "photo"> & { photo_path: string | null })[]).map(
            ({ photo_path, ...p }) => ({ ...p, photo: productThumbUrl(photo_path) }),
          )}
          currency={currency}
        />
      </section>
    </>
  );
}
