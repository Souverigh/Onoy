import { getUserContext } from "@/lib/context";
import { createOrganization, logout } from "../auth/actions";
import { Submit } from "@/components/submit";
import { FormDraft } from "@/components/form-draft";
import { SignupIntro } from "@/components/signup-intro";
import { cookies } from "next/headers";
import { BUSINESS_COOKIE, BUSINESS_TYPES, DEFAULT_BUSINESS, PRESETS, isBusinessType } from "@/lib/business";

/** Поля, которые помним в браузере, пока магазин не открыт (ушёл — вернулся — всё на месте). */
const DRAFT_FIELDS = ["name", "business_type", "seller_name", "phone", "currency"];

// Третий шаг регистрации: магазин и вид бизнеса. Сюда же ведёт любой вход
// аккаунта без магазина (getContext), так что бросить и вернуться можно когда угодно.
export default async function Onboarding({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { db, user } = await getUserContext();
  const { error } = await searchParams;
  // Пришли по адресу вида (/start/prokat) — он уже выбран: в куке на этом
  // телефоне или в аккаунте, если письмо открыли на другом.
  const chosen = (await cookies()).get(BUSINESS_COOKIE)?.value;
  const meta = (await db.auth.getClaims()).data?.claims?.user_metadata as
    | { business_type?: unknown; terms_version?: unknown }
    | undefined;
  // Вход через Google обходит галочку регистрации — спрашиваем согласие здесь.
  const needsConsent = !meta?.terms_version;
  const business = isBusinessType(chosen)
    ? chosen
    : isBusinessType(meta?.business_type)
      ? meta.business_type
      : DEFAULT_BUSINESS;
  return (
    <main className="auth">
      <SignupIntro step={3} />
      <section className="auth-form">
        <div className="auth-card onboarding-card">
          <span className="eyebrow">ШАГ 3 ИЗ 3</span>
          <h2>Ваш магазин</h2>
          <p className="muted">
            Название, имя и телефон будут на накладных клиентам. Всё можно поменять в Настройках.
          </p>
          <form action={createOrganization} id="onboarding-form">
            <FormDraft formId="onboarding-form" storageKey={`depter-onboarding-${user.id}`} fields={DRAFT_FIELDS} />
            <input type="hidden" name="key" value={crypto.randomUUID()} />
            <div className="form-grid">
              <label>
                Название магазина
                <input name="name" placeholder="Например, Свет Маркет" required maxLength={120} />
              </label>
              <label>
                Чем вы занимаетесь
                <select name="business_type" defaultValue={business}>
                  {BUSINESS_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {PRESETS[type].label}
                    </option>
                  ))}
                </select>
                <small className="muted">Под это настроим разделы и кнопки.</small>
              </label>
              <label>
                Ваше имя
                <input name="seller_name" placeholder="Например, Маликнур" required maxLength={80} autoComplete="name" />
                <small className="muted">На накладной в строке «Продавец».</small>
              </label>
              <label>
                Телефон
                <input name="phone" type="tel" placeholder="+996 773 033 399" required maxLength={40} autoComplete="tel" />
                <small className="muted">Клиенты напишут сюда в WhatsApp.</small>
              </label>
              <label>
                Основная валюта
                <select name="currency" defaultValue="KGS">
                  <option value="KGS">Сом - Кыргызстан</option>
                  <option value="RUB">Рубль - Россия</option>
                </select>
                <small className="muted">В ней считаются итоги. Клиенту в долларах можно задать свою.</small>
              </label>
            </div>
            {needsConsent && (
              <label className="consent">
                <input type="checkbox" name="accept" value="1" required />
                <span>
                  Принимаю{" "}
                  <a href="/terms" target="_blank" rel="noreferrer">
                    Пользовательское соглашение
                  </a>{" "}
                  и{" "}
                  <a href="/privacy" target="_blank" rel="noreferrer">
                    Политику конфиденциальности
                  </a>
                  , согласен на обработку персональных данных
                </span>
              </label>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error === "consent"
                  ? "Чтобы открыть магазин, примите Пользовательское соглашение и Политику конфиденциальности."
                  : error === "seller"
                    ? "Впишите ваше имя и телефон - они нужны для накладных."
                    : "Не удалось создать магазин. Проверьте название и попробуйте ещё раз."}
              </p>
            )}
            <Submit>Войти в магазин</Submit>
          </form>
          <form action={logout} className="onboarding-logout">
            <small className="muted">
              {user.email ? `Вы вошли как ${user.email}. ` : ""}Вы продавец? Откройте ссылку-приглашение от
              владельца или{" "}
              <button type="submit" className="text-button">
                выйдите
              </button>
            </small>
          </form>
        </div>
      </section>
    </main>
  );
}
