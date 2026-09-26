import "server-only";
import { randomUUID, createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type OperationKind = "purchase" | "sale" | "payment";

function extensionOf(file: File) {
  const fromName = file.name.split(".").pop();
  return (fromName && fromName.length <= 10 ? fromName : "jpg").toLowerCase();
}

/** Продавец фотографирует накладную/чек — фото становится основанием операции. */
export async function uploadOperationPhoto(
  db: SupabaseClient,
  organizationId: string,
  kind: OperationKind,
  file: File,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");
  const path = `${organizationId}/${kind}/${randomUUID()}.${extensionOf(file)}`;
  const upload = await db.storage
    .from("receipts")
    .upload(path, buffer, { contentType: file.type || "image/jpeg" });
  if (upload.error) {
    console.error("uploadOperationPhoto: storage upload failed", upload.error);
    throw new Error("upload_failed");
  }
  const { data, error } = await db.rpc("create_document", {
    p_org: organizationId,
    p_kind: kind,
    p_storage_path: path,
    p_file_hash: hash,
    p_mime_type: file.type || "image/jpeg",
  });
  if (error || !data) {
    console.error("uploadOperationPhoto: create_document failed", error);
    throw new Error(
      error?.message.includes("document_in_use") ? "document_in_use" : "document_failed",
    );
  }
  return data as string;
}

/** Клиент прикладывает фото квитанции к заявке «Я оплатил» без входа в систему. */
export async function uploadClaimPhoto(
  anon: SupabaseClient,
  token: string,
  file: File,
): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");
  const path = `claims/${token}/${randomUUID()}.${extensionOf(file)}`;
  const upload = await anon.storage
    .from("receipts")
    .upload(path, buffer, { contentType: file.type || "image/jpeg" });
  if (upload.error) {
    console.error("uploadClaimPhoto: storage upload failed", upload.error);
    throw new Error("upload_failed");
  }
  const { data, error } = await anon.rpc("create_claim_document", {
    p_token: token,
    p_storage_path: path,
    p_file_hash: hash,
    p_mime_type: file.type || "image/jpeg",
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
