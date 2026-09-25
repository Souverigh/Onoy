import type { Directory } from "./validation";
export const directoryMeta: Record<
  Directory,
  { title: string; single: string; view: string; description: string }
> = {
  customers: {
    title: "Клиенты",
    single: "Клиент",
    view: "customer_balances",
    description: "Контакты и долги покупателей.",
  },
  suppliers: {
    title: "Поставщики",
    single: "Поставщик",
    view: "supplier_balances",
    description: "Контакты и расчёты за товар.",
  },
  products: {
    title: "Товары",
    single: "Товар",
    view: "product_balances",
    description: "Ваш ассортимент, цены и остатки.",
  },
};
export type Entry = {
  id: string;
  name: string;
  phone?: string;
  notes?: string;
  sku?: string;
  unit?: string;
  purchase_price?: string;
  sale_price?: string;
  min_stock?: string;
  stock?: string;
  balance?: string;
  aliases?: string[];
};
