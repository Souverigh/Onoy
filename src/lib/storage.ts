import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PAGES, documentMimeType, isAcceptedDocument } from "./pages";

export type OperationKind = "purchase" | "sale" | "payment" | "expense";

function extensionOf(file: File) {
  const fromName = file.name.split(".").pop();
  return (fromName && fromName.length <= 10 ? fromName : "jpg").toLowerCase();
}


/**
 * Хеш документа: у одностраничного — хеш самого фото (как было всегда), у
 * многостраничного — хеш набора страниц по порядку. По нему create_document
 * находит повтор, а кеш распознавания — готовый ответ.
 */
export function documentHash(pageHashes: string[]) {
  if (pageHashes.length === 1) return pageHashes[0];
  return createHash("sha256").update("pages:" + pageHashes.join(":")).digest("hex");
}

/** Продавец фотографирует накладную/чек — фото становится основанием операции. */
export async function uploadOperationPhoto(
  db: SupabaseClient,
  organizationId: string,
  kind: OperationKind,
  file: File,
): Promise<string> {
  return uploadOperationPhotos(db, organizationId, kind, [file]);
}

/**
 * Накладная на нескольких листах — один документ: первая страница в
 * documents, остальные в document_pages (add_document_pages).
 */
export async function uploadOperationPhotos(
  db: SupabaseClient,
  organizationId: string,
  kind: OperationKind,
  files: File[],
): Promise<string> {
  if (files.length === 0 || files.length > MAX_PAGES) throw new Error("upload_failed");
  // Только фото и PDF: другой файл Gemini не прочитает, а в просмотре не покажется.
  if (files.some((file) => !isAcceptedDocument(file)))
    throw new Error("upload_failed");
  const pages = await Promise.all(
    files.map(async (file) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = createHash("sha256").update(buffer).digest("hex");
      const path = `${organizationId}/${kind}/${randomUUID()}.${extensionOf(file)}`;
      const mimeType = documentMimeType(file);
      const upload = await db.storage
        .from("receipts")
        .upload(path, buffer, { contentType: mimeType });
      if (upload.error) {
        console.error("uploadOperationPhotos: storage upload failed", upload.error);
        throw new Error("upload_failed");
      }
      return { storage_path: path, file_hash: hash, mime_type: mimeType };
    }),
  );
  const [first, ...rest] = pages;
  const { data, error } = await db.rpc("create_document", {
    p_org: organizationId,
    p_kind: kind,
    p_storage_path: first.storage_path,
    p_file_hash: documentHash(pages.map((p) => p.file_hash)),
    p_mime_type: first.mime_type,
  });
  if (error || !data) {
    console.error("uploadOperationPhotos: create_document failed", error);
    throw new Error(
      error?.message.includes("document_in_use") ? "document_in_use" : "document_failed",
    );
  }
  if (rest.length) {
    const added = await db.rpc("add_document_pages", {
      p_org: organizationId,
      p_document: data,
      p_pages: rest,
    });
    if (added.error) {
      console.error("uploadOperationPhotos: add_document_pages failed", added.error);
      throw new Error("document_failed");
    }
  }
  return data as string;
}

/**
 * Страницы тетради при переносе долгов — фото остаётся в истории у записей
 * «Долг из тетради» (sales/purchases/payments.notebook_photos). Не documents:
 * одна страница — много клиентов. Не получилось — пустой список, перенос
 * от этого не ломается.
 */
export async function uploadNotebookPhotos(
  db: SupabaseClient,
  organizationId: string,
  files: File[],
): Promise<string[]> {
  try {
    return await Promise.all(
      files.map(async (file) => {
        const path = `${organizationId}/notebook/${randomUUID()}.${extensionOf(file)}`;
        const upload = await db.storage
          .from("receipts")
          .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: documentMimeType(file) });
        if (upload.error) throw upload.error;
        return path;
      }),
    );
  } catch (error) {
    console.error("uploadNotebookPhotos: storage upload failed", error);
    return [];
  }
}

/**
 * Ссылки на фото тетради у записей «Долг из тетради»: id записи → ссылки на
 * час. Колонки может ещё не быть (миграция не применена) — тогда пусто.
 */
export async function notebookPhotoUrls(
  db: SupabaseClient,
  organizationId: string,
  table: "sales" | "purchases" | "payments",
  ids: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (!ids.length) return result;
  const { data, error } = await db
    .from(table)
    .select("id,notebook_photos")
    .eq("organization_id", organizationId)
    .in("id", ids)
    .not("notebook_photos", "is", null);
  if (error || !data?.length) return result;
  const rows = data as { id: string; notebook_photos: string[] }[];
  const paths = [...new Set(rows.flatMap((row) => row.notebook_photos))];
  const signed = await db.storage.from("receipts").createSignedUrls(paths, 3600);
  if (signed.error) {
    console.error("notebookPhotoUrls: signing failed", signed.error);
    return result;
  }
  const urls = new Map(signed.data.map((item) => [item.path, item.signedUrl]));
  for (const row of rows) {
    const list = row.notebook_photos.map((path) => urls.get(path)).filter((url): url is string => Boolean(url));
    if (list.length) result.set(row.id, list);
  }
  return result;
}

export type DocumentPage = { storage_path: string; mime_type: string };

/** Все страницы документа по порядку: первая — из documents, остальные — из document_pages. */
export async function documentPages(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
): Promise<DocumentPage[]> {
  const [doc, extra] = await Promise.all([
    db
      .from("documents")
      .select("storage_path,mime_type")
      .eq("organization_id", organizationId)
      .eq("id", documentId)
      .maybeSingle(),
    db
      .from("document_pages")
      .select("storage_path,mime_type")
      .eq("organization_id", organizationId)
      .eq("document_id", documentId)
      .order("page_no"),
  ]);
  if (doc.error || !doc.data) return [];
  // Таблицы страниц может ещё не быть (миграция не применена) — тогда одна страница.
  if (extra.error) console.error("documentPages: document_pages lookup failed", extra.error);
  return [doc.data as DocumentPage, ...((extra.data ?? []) as DocumentPage[])];
}

/**
 * Фото этого документа уже стоит за действующей записью — возможно только
 * когда магазин разрешил повторы (organizations.block_duplicate_photos=false);
 * запись не блокируется, продавцу показываем предупреждение.
 */
export async function isDuplicatePhoto(
  db: SupabaseClient,
  organizationId: string,
  documentId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("document_is_duplicate", {
    p_org: organizationId,
    p_document: documentId,
  });
  if (error) {
    console.error("isDuplicatePhoto: check failed", error);
    return false;
  }
  return data === true;
}

/** Клиент прикладывает фото квитанции к заявке «Я оплатил» без входа в систему. */
export async function uploadClaimPhoto(
  anon: SupabaseClient,
  token: string,
  file: File,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");
  if (!isAcceptedDocument(file)) throw new Error("upload_failed");
  const path = `claims/${token}/${randomUUID()}.${extensionOf(file)}`;
  const upload = await anon.storage
    .from("receipts")
    .upload(path, buffer, { contentType: documentMimeType(file) });
  if (upload.error) {
    console.error("uploadClaimPhoto: storage upload failed", upload.error);
    throw new Error("upload_failed");
  }
  const { data, error } = await anon.rpc("create_claim_document", {
    p_token: token,
    p_storage_path: path,
    p_file_hash: hash,
    p_mime_type: documentMimeType(file),
  });
  if (error || !data) {
    console.error("uploadClaimPhoto: create_claim_document failed", error);
    throw new Error("document_failed");
  }
  return data as string;
}

/** Подписанная ссылка на фото на час — фото не публичны, доступ только участникам магазина. */
export async function signedPhotoUrl(db: SupabaseClient, path: string) {
  const { data } = await db.storage.from("receipts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}
