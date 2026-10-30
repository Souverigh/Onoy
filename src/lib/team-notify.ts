import "server-only";
import { PRESETS, isBusinessType } from "./business";
import { notifyTeam, siteUrl, tg } from "./telegram";

type NewUser = { id: string; email?: string | null; created_at?: string | null };

/** Аккаунт создан только что — не повтор регистрации на тот же email и не вход. */
const justCreated = (user: NewUser | null | undefined): user is NewUser =>
  Boolean(user?.created_at && Date.now() - Date.parse(user.created_at) < 120_000);

const businessLabel = (type: unknown) => (isBusinessType(type) ? PRESETS[type].label : null);

/** «🆕 Регистрация» — почтой (ждёт подтверждения) или через Google. */
export function notifySignup(user: NewUser | null | undefined, how: "email" | "google", business?: unknown) {
  if (!justCreated(user)) return;
  const kind = businessLabel(business);
  notifyTeam(
    [
      `🆕 <b>Регистрация${how === "google" ? " через Google" : ""}</b>`,
      `${tg(user.email)}${kind ? ` · ${tg(kind)}` : ""}`,
      how === "email" ? "Ждёт подтверждения почты" : null,
      `<a href="${siteUrl(`/admin/account/${user.id}`)}">Открыть в админке</a>`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

/** «🏪 Новый магазин» — после шага «Ваш магазин». */
export function notifyShop(shop: { id: string; name: string; business: unknown; phone: string; seller: string; email: string | null }) {
  notifyTeam(
    [
      `🏪 <b>Новый магазин</b>: ${tg(shop.name)}`,
      [businessLabel(shop.business) ?? "Магазин", shop.seller, shop.phone, shop.email].filter(Boolean).map(tg).join(" · "),
      `<a href="${siteUrl(`/admin/shop/${shop.id}`)}">Открыть в админке</a>`,
    ].join("\n"),
  );
}
