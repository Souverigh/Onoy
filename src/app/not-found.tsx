import Link from "next/link";
export default function NotFound() {
  return (
    <main className="center">
      <section className="panel">
        <h1>Страница не найдена</h1>
        <Link className="button primary" href="/">
          На главную
        </Link>
      </section>
    </main>
  );
}
