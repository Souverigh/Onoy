"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext, requireOwner } from "@/lib/context";
import { isDirectory, directoryInput } from "@/lib/validation";
import { storedPhone } from "@/lib/contacts";
import { promisedDateInput } from "@/lib/promise";
import { bishkekDate } from "@/lib/day-summary";
import { phoneKey } from "@/lib/contacts";
import { bestMatches } from "@/lib/match";

/** Похожее имя — «Похоже, это Айбек» (задача 24), как в форме продажи. */
const SAME_PERSON = 0.8;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function saveEntry(form: FormData) {
  const kind = String(form.get("kind"));
  if (!isDirectory(kind)) throw new Error("Неизвестный справочник");
  const { db, organizationId } = await getContext();
  const id = String(form.get("id") ?? "");
  if (id && !/^[a-f0-9-]{36}$/i.test(id))
    throw new Error("Неверный идентификатор");
  let input: Record<string, unknown>;
  try {
    input = directoryInput(kind, Object.fromEntries(form));
    // Телефон в одном виде (+996… / +7…) — иначе один номер «разный».
    if (typeof input.phone === "string") input.phone = storedPhone(input.phone).slice(0, 40);
  } catch {
    redirect(`/${kind}/${id || "new"}?error=invalid`);
  }
  // Валюту не трогаем, если её не меняли: у контрагента с записями база
  // запрещает смену (currency_locked), даже null → та же валюта.
  if (id && kind !== "products") {
    const current = await db.from(kind).select("currency").eq("organization_id", organizationId).eq("id", id).maybeSingle();
    if ((current.data?.currency ?? null) === (input.currency ?? null)) delete input.currency;
  }
  // Дубль клиента или поставщика (задача 24): тот же телефон или похожее имя —
  // сначала «Похоже, это Айбек. Открыть его?», создаём только после «Нет».
  if (!id && kind !== "products" && form.get("force") !== "1") {
    const others = await db
      .from(kind)
      .select("id,name,phone,aliases")
      .eq("organization_id", organizationId)
      .is("merged_into_id", null)
      .range(0, 4999);
    const list = (others.data ?? []) as { id: string; name: string; phone: string; aliases: string[] }[];
    const key = phoneKey(String(input.phone ?? ""));
    const twin =
      (key ? list.find((p) => p.phone && phoneKey(p.phone) === key) : undefined) ??
      bestMatches(String(input.name ?? ""), list, 1, SAME_PERSON)[0]?.candidate;
    if (twin) {
      const params = new URLSearchParams({ dup: twin.id, name: String(input.name ?? ""), phone: String(input.phone ?? "") });
      redirect(`/${kind}/new?${params.toString()}`);
    }
  }
  const result = id
    ? await db
        .from(kind)
        .update(input)
        .eq("organization_id", organizationId)
        .eq("id", id)
        .select("id")
        .single()
    : await db
        .from(kind)
        .insert({ ...input, organization_id: organizationId })
        .select("id")
        .single();
  if (result.error || !result.data)
    redirect(
      `/${kind}/${id || "new"}?error=${
        result.error?.code === "23505"
          ? "duplicate"
          : result.error?.message.includes("currency_locked")
            ? "currency_locked"
            : "save"
      }`,
    );
  revalidatePath("/", "layout");
  // Новый клиент — «Клиент добавлен», правка — «Изменения сохранены» (задача 37).
  redirect(`/${kind}/${result.data.id}?${id ? "saved=1" : "added=1"}`);
}

export async function createLink(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  if (!uuidPattern.test(customerId)) redirect("/customers?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("create_share_link", {
    p_org: organizationId,
    p_customer: customerId,
  });
  if (result.error) redirect(`/customers/${customerId}?error=link`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?linked=1`);
}

export async function revokeLink(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  const linkId = String(form.get("link_id") ?? "");
  if (!uuidPattern.test(customerId) || !uuidPattern.test(linkId))
    redirect("/customers?error=invalid");
  const { db, organizationId } = await getContext();
  const result = await db.rpc("revoke_share_link", {
    p_org: organizationId,
    p_link: linkId,
  });
  if (result.error) redirect(`/customers/${customerId}?error=link`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?revoked=1`);
}

/** Обещанная дата оплаты: пусто — убрать; прошлое и дальше года — ошибка. */
export async function setPromisedDate(form: FormData) {
  const customerId = String(form.get("customer_id") ?? "");
  if (!uuidPattern.test(customerId)) redirect("/customers?error=invalid");
  const today = bishkekDate();
  // Кнопки «Завтра» и «Через неделю» — без выбора даты в календаре.
  const preset = String(form.get("preset") ?? "");
  const shift = preset === "tomorrow" ? 1 : preset === "week" ? 7 : preset === "clear" ? -1 : 0;
  const raw =
    shift > 0
      ? bishkekDate(new Date(new Date(`${today}T12:00:00+06:00`).getTime() + shift * 86400000))
      : shift < 0
        ? ""
        : String(form.get("promised_date") ?? "");
  const promised = promisedDateInput(raw, today);
  if (promised === undefined) redirect(`/customers/${customerId}?error=promise`);
  const { db, organizationId } = await getContext();
  const result = await db
    .from("customers")
    .update({ promised_date: promised })
    .eq("organization_id", organizationId)
    .eq("id", customerId);
  if (result.error) redirect(`/customers/${customerId}?error=promise`);
  revalidatePath("/", "layout");
  redirect(`/customers/${customerId}?promised=${promised ? "1" : "0"}`);
}

/** Удалить / в архив / вернуть / объединить контрагента (ТЗ §15.2). */
function partyKind(form: FormData) {
  const kind = String(form.get("kind") ?? "");
  const id = String(form.get("id") ?? "");
  if ((kind !== "customers" && kind !== "suppliers") || !uuidPattern.test(id)) redirect("/customers?error=invalid");
  return { kind, id };
}

export async function deleteParty(form: FormData) {
  const { kind, id } = partyKind(form);
  const { db, organizationId } = await getContext();
  const result = await db.rpc("delete_party", { p_org: organizationId, p_kind: kind, p_id: id });
  if (result.error)
    redirect(`/${kind}/${id}?error=${result.error.message.includes("has_records") ? "has_records" : "party"}`);
  revalidatePath("/", "layout");
  redirect(`/${kind}?deleted=1`);
}

export async function setArchived(form: FormData) {
  const { kind, id } = partyKind(form);
  const archived = form.get("archived") === "true";
  const { db, organizationId } = await getContext();
  const result = await db.rpc("set_party_archived", { p_org: organizationId, p_kind: kind, p_id: id, p_archived: archived });
  if (result.error) redirect(`/${kind}/${id}?error=party`);
  revalidatePath("/", "layout");
  redirect(`/${kind}/${id}?${archived ? "archived" : "restored"}=1`);
}

export async function mergeParty(form: FormData) {
  const { kind, id } = partyKind(form);
  const into = String(form.get("into") ?? "");
  if (!uuidPattern.test(into) || into === id) redirect(`/${kind}/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("merge_party", { p_org: organizationId, p_kind: kind, p_from: id, p_into: into });
  if (result.error)
    redirect(
      `/${kind}/${id}?error=${
        result.error.message.includes("opening_conflict")
          ? "merge_opening"
          : result.error.message.includes("currency_mismatch")
            ? "merge_currency"
            : "merge"
      }`,
    );
  revalidatePath("/", "layout");
  redirect(`/${kind}/${into}?merged=1`);
}

export async function undoMerge(form: FormData) {
  const { kind, id } = partyKind(form);
  const merge = String(form.get("merge") ?? "");
  if (!uuidPattern.test(merge)) redirect(`/${kind}/${id}?error=merge`);
  const { db, organizationId } = await requireOwner();
  const result = await db.rpc("undo_merge", { p_org: organizationId, p_merge: merge });
  if (result.error) redirect(`/${kind}/${id}?error=merge_expired`);
  revalidatePath("/", "layout");
  redirect(`/${kind}/${id}?unmerged=1`);
}
