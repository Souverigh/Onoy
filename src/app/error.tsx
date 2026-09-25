"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="center">
      <section className="panel">
        <h1>Не удалось открыть кабинет</h1>
        <p>Проверьте подключение базы и попробуйте снова.</p>
        <button className="button primary" onClick={reset}>
          Повторить
        </button>
      </section>
    </main>
  );
}
