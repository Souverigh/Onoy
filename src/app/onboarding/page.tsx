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
        <div className="brand">Oŋoy</div>
        <h1>Как называется ваш магазин?</h1>
        <p className="muted">
          Начните с названия. Клиентов и товары можно добавить следующим шагом.
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
          {error && (
            <p role="alert" className="form-error">
              Не удалось создать магазин. Проверьте название и подключение базы.
            </p>
          )}
          <Submit>Открыть магазин</Submit>
        </form>
      </section>
    </main>
  );
}
