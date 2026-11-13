import "server-only";
import { z } from "zod";
import { recognizeDeepSeekDocument, type OcrPurpose } from "@minibot/agent";
import { and, eq, schema, sql } from "@minibot/db";
import { db } from "../db";
import { findDownload } from "./attachments";

const { attachmentOcr } = schema;

export async function resolveChatAttachment(userId: string, conversationId: string, id: string) {
  const file = z.uuid().safeParse(id).success
    ? await findDownload(userId, conversationId, id)
    : null;
  if (!file) throw new Error("Attachment not found in this conversation.");
  return file;
}

export async function recognizeChatAttachment(
  userId: string,
  conversationId: string,
  apiKey: string,
  id: string,
  purpose: OcrPurpose,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const file = await resolveChatAttachment(userId, conversationId, id);
  if (!/\.(pdf|docx?|pptx?|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.filename)) {
    throw new Error("OCR supports PDF, Word, PowerPoint and supported image formats.");
  }

  return db.transaction(async (tx) => {
    // A fork shares the original attachment. Serialize recognition for each attachment and
    // purpose across conversations and web processes, then check the cache under that lock.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`minibot-ocr:${id}:${purpose}`}, 0))`,
    );
    signal?.throwIfAborted();
    const [cached] = await tx
      .select({ pages: attachmentOcr.pages })
      .from(attachmentOcr)
      .where(and(eq(attachmentOcr.attachmentId, id), eq(attachmentOcr.purpose, purpose)));
    if (cached) return cached.pages;

    // Once submitted, DeepSeek continues and may charge even after disconnect. Keep the
    // response alive so a stopped chat can reuse the result instead of submitting again.
    signal?.throwIfAborted();
    const input = new File([new Uint8Array(file.bytes)], file.filename, { type: file.mediaType });
    const pages = await recognizeDeepSeekDocument(apiKey, input, purpose);
    await tx.insert(attachmentOcr).values({ attachmentId: id, purpose, pages });
    return pages;
  });
}
