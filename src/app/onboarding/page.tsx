import { getUserContext } from "@/lib/context";
import { createOrganization } from "../auth/actions";
import { Submit } from "@/components/submit";
export default async function Onboarding({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await getUserContext();
  const { error } = await searchParams;
  return (
    <main className="center">
      <section className="panel onboarding">
        <div className="brand">Depter</div>
        <h1>Ваш магазин</h1>
        <p className="muted">
          Название, имя продавца и телефон - они будут на накладных клиентам. Клиентов и поставщиков можно
          добавить следующим шагом.
        </p>
        <p className="muted">
          Продавцу магазина здесь ничего создавать не нужно - откройте ссылку-приглашение от владельца.
        </p>
        <form action={createOrganization}>
          <input type="hidden" name="key" value={crypto.randomUUID()} />
          <label>
            Название магазина
            <input
              name="name"
              placeholder="Например, Свет Маркет"
              required
              maxLength={120}
            />
          </label>
          <label>
            Имя продавца
            <input name="seller_name" placeholder="Например, Маликнур" required maxLength={80} autoComplete="name" />
            <small className="muted">Пишется на накладной в строке «Продавец».</small>
          </label>
          <label>
            Телефон
            <input name="phone" type="tel" placeholder="+996 773 033 399" required maxLength={40} autoComplete="tel" />
            <small className="muted">На накладной и для WhatsApp - клиенты напишут сюда.</small>
          </label>
          <label>
            Основная валюта
            <select name="currency" defaultValue="KGS">
              <option value="KGS">Сом - Кыргызстан</option>
              <option value="RUB">Рубль - Россия</option>
            </select>
            <small className="muted">
              В ней считаются итоги. Поставщику или клиенту в долларах можно задать свою валюту.
            </small>
          </label>
          <label>
            Код доступа
            <input
              name="code"
              required
              maxLength={40}
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="Например, 7F3A9C21B0"
            />
            <small className="muted">Код выдаёт Depter при подключении магазина.</small>
          </label>
          {error && (
            <p role="alert" className="form-error">
              {error === "code"
                ? "Код доступа не подошёл или уже использован. Попросите новый у Depter."
                : error === "seller"
                  ? "Впишите имя продавца и телефон - они нужны для накладных."
                  : "Не удалось создать магазин. Проверьте название и подключение базы."}
            </p>
          )}
          <Submit>Открыть магазин</Submit>
        </form>
      </section>
    </main>
  );
}
