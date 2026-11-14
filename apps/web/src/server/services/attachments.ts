import "server-only";
import { createHash } from "node:crypto";
import { deleteDeepSeekFile, uploadDeepSeekFile, type FileUserMessage } from "@minibot/agent";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lt,
  notExists,
  or,
  schema,
  type DbExecutor,
} from "@minibot/db";
import { db } from "../db";
import { documentPurpose, type AttachmentInfo } from "@/lib/chat/attachments";

const { attachment, conversation, message, messageAttachment } = schema;
const publicColumns = {
  id: attachment.id,
  filename: attachment.filename,
  mediaType: attachment.mediaType,
};
const fileColumns = {
  ...publicColumns,
  providerFileId: attachment.providerFileId,
  credentialHash: attachment.credentialHash,
};

export type ChatAttachment = AttachmentInfo & { providerFileId: string; credentialHash: string };

export function fileCredentialHash(apiKey: string) {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function withFileReferences(
  user: FileUserMessage,
  files: ChatAttachment[],
): FileUserMessage {
  return files.length
    ? {
        ...user,
        providerFileIds: files.map((file) => file.providerFileId),
        localAttachments: files.map(({ id, filename }) => ({ id, filename })),
      }
    : user;
}

export async function uploadDocument(
  userId: string,
  conversationId: string,
  apiKey: string,
  file: File,
) {
  const purpose = documentPurpose(file.name);
  if (!purpose) throw new Error("Unsupported document.");
  return uploadAttachment(userId, conversationId, apiKey, file, purpose);
}

export async function uploadAttachment(
  userId: string,
  conversationId: string,
  apiKey: string,
  file: File,
  purpose: Parameters<typeof uploadDeepSeekFile>[2],
) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const providerFileId = await uploadDeepSeekFile(apiKey, file, purpose);
  try {
    const [row] = await db
      .insert(attachment)
      .values({
        userId,
        draftConversationId: conversationId,
        filename: file.name,
        mediaType: file.type || "application/octet-stream",
        size: file.size,
        bytes,
        providerFileId,
        credentialHash: fileCredentialHash(apiKey),
      })
      .returning(publicColumns);
    return row!;
  } catch (error) {
    await cleanupProviderFiles(apiKey, [
      { providerFileId, credentialHash: fileCredentialHash(apiKey) },
    ]);
    throw error;
  }
}

export async function getDraftAttachments(
  tx: DbExecutor,
  userId: string,
  conversationId: string,
  ids: string[],
) {
  if (!ids.length) return [];
  const files = await tx
    .select(fileColumns)
    .from(attachment)
    .where(
      and(
        eq(attachment.userId, userId),
        eq(attachment.draftConversationId, conversationId),
        inArray(attachment.id, ids),
      ),
    )
    .for("update");
  const byId = new Map(files.map((file) => [file.id, file]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function linkMessageAttachments(tx: DbExecutor, messageId: string, ids: string[]) {
  if (!ids.length) return;
  await tx
    .insert(messageAttachment)
    .values(ids.map((attachmentId, position) => ({ messageId, attachmentId, position })));
  await tx.update(attachment).set({ draftConversationId: null }).where(inArray(attachment.id, ids));
}

const noMessageReferences = (tx: DbExecutor) =>
  notExists(
    tx
      .select({ id: messageAttachment.messageId })
      .from(messageAttachment)
      .where(eq(messageAttachment.attachmentId, attachment.id)),
  );
const providerColumns = {
  providerFileId: attachment.providerFileId,
  credentialHash: attachment.credentialHash,
};

export function deleteUnusedAttachments(tx: DbExecutor, ids: string[]) {
  if (!ids.length) return Promise.resolve([]);
  return tx
    .delete(attachment)
    .where(
      and(
        inArray(attachment.id, ids),
        isNull(attachment.draftConversationId),
        noMessageReferences(tx),
      ),
    )
    .returning(providerColumns);
}

export function deleteDraftAttachments(
  tx: DbExecutor,
  userId: string,
  conversationId: string,
  id?: string,
) {
  return tx
    .delete(attachment)
    .where(
      and(
        eq(attachment.userId, userId),
        eq(attachment.draftConversationId, conversationId),
        id ? eq(attachment.id, id) : undefined,
      ),
    )
    .returning(providerColumns);
}

export async function expireDraftAttachments(userId: string, apiKey: string) {
  const files = await db
    .delete(attachment)
    .where(
      and(
        eq(attachment.userId, userId),
        eq(attachment.credentialHash, fileCredentialHash(apiKey)),
        isNotNull(attachment.draftConversationId),
        lt(attachment.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .returning(providerColumns);
  await cleanupProviderFiles(apiKey, files);
}

export async function cleanupProviderFiles(
  apiKey: string | null,
  files: Pick<ChatAttachment, "providerFileId" | "credentialHash">[],
) {
  if (!apiKey || !files.length) return;
  const credentialHash = fileCredentialHash(apiKey);
  await Promise.all(
    files
      .filter((file) => file.credentialHash === credentialHash)
      .map(async (file) => {
        try {
          await deleteDeepSeekFile(apiKey, file.providerFileId);
        } catch (error) {
          console.error("DeepSeek file cleanup failed", error);
        }
      }),
  );
}

export async function findDownload(
  userId: string,
  conversationId: string,
  id: string,
  allowDraft = false,
) {
  const [file] = await db
    .select({
      ...publicColumns,
      bytes: attachment.bytes,
    })
    .from(attachment)
    .where(
      and(
        eq(attachment.id, id),
        eq(attachment.userId, userId),
        or(
          allowDraft ? eq(attachment.draftConversationId, conversationId) : undefined,
          exists(
            db
              .select({ id: messageAttachment.attachmentId })
              .from(messageAttachment)
              .innerJoin(message, eq(message.id, messageAttachment.messageId))
              .innerJoin(conversation, eq(conversation.id, message.conversationId))
              .where(
                and(
                  eq(messageAttachment.attachmentId, attachment.id),
                  eq(conversation.id, conversationId),
                  eq(conversation.userId, userId),
                ),
              ),
          ),
        ),
      ),
    );
  return file ?? null;
}

export async function listMessageAttachments(tx: DbExecutor, messageIds: string[]) {
  const byMessage = new Map<string, ChatAttachment[]>();
  if (!messageIds.length) return byMessage;
  const rows = await tx
    .select({
      ...fileColumns,
      messageId: messageAttachment.messageId,
    })
    .from(messageAttachment)
    .innerJoin(attachment, eq(attachment.id, messageAttachment.attachmentId))
    .where(inArray(messageAttachment.messageId, messageIds))
    .orderBy(asc(messageAttachment.position));
  for (const { messageId, ...file } of rows) {
    const files = byMessage.get(messageId) ?? [];
    files.push(file);
    byMessage.set(messageId, files);
  }
  return byMessage;
}

export async function lockAttachments(tx: DbExecutor, ids: string[]) {
  if (!ids.length) return;
  await tx
    .select({ id: attachment.id })
    .from(attachment)
    .where(inArray(attachment.id, ids))
    .orderBy(asc(attachment.id))
    .for("update");
}
