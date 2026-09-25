"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="panel empty">
      <h1>Не удалось загрузить данные</h1>
      <p>
        Проверьте соединение и повторите попытку. Изменения не были
        подтверждены.
      </p>
      <button className="button primary" onClick={reset}>
        Попробовать снова
      </button>
    </section>
  );
}
