import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext } from "@/lib/context";
import { isDirectory } from "@/lib/validation";
import { directoryMeta, type Entry } from "@/lib/directory";
import { EntryForm } from "@/components/entry-form";
import { money, quantity } from "@/lib/format";
export default async function EntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { kind, id } = await params;
  if (!isDirectory(kind)) notFound();
  const { db, organizationId } = await getContext();
  const { error, saved } = await searchParams;
  let entry: Entry | undefined;
  if (id !== "new") {
    if (!/^[a-f0-9-]{36}$/i.test(id)) notFound();
    const result = await db
      .from(directoryMeta[kind].view)
      .select("*")
      .eq("organization_id", organizationId)
      .eq("id", id)
      .maybeSingle();
    if (result.error) throw new Error("Не удалось открыть запись");
    if (!result.data) notFound();
    entry = result.data as Entry;
  }
  return (
    <>
      <Link className="back-link" href={`/${kind}`}>
        ← {directoryMeta[kind].title}
      </Link>
      <div className="page-heading">
        <div>
          <h1>
            {entry?.name ??
              `Добавить: ${directoryMeta[kind].single.toLowerCase()}`}
          </h1>
          <p className="muted">
            {entry
              ? kind === "products"
                ? `Остаток: ${quantity(entry.stock ?? 0)} ${entry.unit}`
                : `Долг / аванс: ${money(entry.balance ?? 0)}`
              : "Заполните основные данные."}
          </p>
        </div>
      </div>
      {saved && (
        <p className="notice success" role="status">
          Изменения сохранены.
        </p>
      )}
      <section className="panel form-panel">
        <EntryForm kind={kind} entry={entry} error={error} />
      </section>
    </>
  );
}
