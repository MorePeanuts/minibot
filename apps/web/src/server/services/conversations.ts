import "server-only";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@minibot/agent";
import { and, asc, desc, eq, gte, isNotNull, isNull, schema, type DbExecutor } from "@minibot/db";
import { findTurnEnd, toUIMessages } from "@/lib/chat/ui-messages";
import { db } from "../db";
import { sandboxManager } from "../sandbox";

import {
  cleanupProviderFiles,
  deleteDraftAttachments,
  deleteUnusedAttachments,
  listMessageAttachments,
  lockAttachments,
} from "./attachments";
import { getAgentSettings } from "./settings";

const { conversation, message, messageAttachment } = schema;

export type Conversation = typeof conversation.$inferSelect;
export type ConversationSummary = Pick<Conversation, "id" | "title" | "updatedAt" | "archivedAt">;

export class NotFoundError extends Error {
  constructor(what = "Conversation") {
    super(`${what} not found`);
    this.name = "NotFoundError";
  }
}

const ownedBy = (userId: string, id: string) =>
  and(eq(conversation.id, id), eq(conversation.userId, userId));

export function listConversations(userId: string, { archived = false } = {}) {
  return db
    .select({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      archivedAt: conversation.archivedAt,
    })
    .from(conversation)
    .where(
      and(
        eq(conversation.userId, userId),
        archived ? isNotNull(conversation.archivedAt) : isNull(conversation.archivedAt),
      ),
    )
    .orderBy(desc(conversation.updatedAt));
}

export async function getConversation(userId: string, id: string) {
  const [row] = await db.select().from(conversation).where(ownedBy(userId, id));
  return row ?? null;
}

/** Fetches a conversation, creating it on first message (ids are generated client-side). */
export async function getOrCreateConversation(userId: string, id: string) {
  await db.insert(conversation).values({ id, userId }).onConflictDoNothing();
  const row = await getConversation(userId, id);
  if (!row) throw new NotFoundError(); // id exists but belongs to someone else
  return row;
}

export async function renameConversation(userId: string, id: string, title: string) {
  const rows = await db
    .update(conversation)
    .set({ title })
    .where(ownedBy(userId, id))
    .returning({ id: conversation.id });
  if (rows.length === 0) throw new NotFoundError();
}

export async function setConversationArchived(userId: string, id: string, archived: boolean) {
  const rows = await db
    .update(conversation)
    .set({ archivedAt: archived ? new Date() : null })
    .where(ownedBy(userId, id))
    .returning({ id: conversation.id });
  if (rows.length === 0) throw new NotFoundError();
}

export async function deleteConversation(userId: string, id: string) {
  const { apiKey } = await getAgentSettings(userId);
  const unused = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: conversation.id })
      .from(conversation)
      .where(ownedBy(userId, id))
      .for("update");
    if (!row) throw new NotFoundError();
    const messages = await listMessages(id, tx);
    const files = await listMessageAttachments(
      tx,
      messages.map((entry) => entry.id),
    );
    const ids = [
      ...new Set([...files.values()].flatMap((entries) => entries.map((entry) => entry.id))),
    ];
    await lockAttachments(tx, ids);
    await tx.delete(conversation).where(ownedBy(userId, id));
    return [
      ...(await deleteDraftAttachments(tx, userId, id)),
      ...(await deleteUnusedAttachments(tx, ids)),
    ];
  });
  await cleanupProviderFiles(apiKey, unused);
  await sandboxManager.remove(id).catch((error) => console.error("sandbox cleanup failed", error));
}

/** Marks a conversation as recently active (sidebar ordering). */
export async function touchConversation(id: string) {
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, id));
}

export async function hasUserMessage(userId: string, conversationId: string, messageId: string) {
  const [row] = await db
    .select({ id: message.id })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(
      and(ownedBy(userId, conversationId), eq(message.id, messageId), eq(message.role, "user")),
    );
  return Boolean(row);
}

export function listMessages(conversationId: string, tx: DbExecutor = db) {
  return tx
    .select({ id: message.id, seq: message.seq, data: message.data })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.seq));
}

export async function getAssistantReplyText(
  userId: string,
  conversationId: string,
  messageId: string,
) {
  const rows = await db
    .select({ id: message.id, data: message.data })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(ownedBy(userId, conversationId))
    .orderBy(asc(message.seq));
  const start = rows.findIndex((row) => row.id === messageId);
  if (start < 0 || rows[start]?.data.role !== "assistant") return null;

  const previousUser = rows.findLastIndex(
    (row, index) => index < start && row.data.role === "user",
  );
  const firstAssistant = rows.findIndex(
    (row, index) => index > previousUser && row.data.role === "assistant",
  );
  if (start !== firstAssistant) return null;

  const end = findTurnEnd(rows, messageId);
  const [reply] = toUIMessages(rows.slice(start, end + 1));
  return (
    reply?.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n")
      .trim() ?? ""
  );
}

export async function listMessagesWithAttachments(conversationId: string) {
  const rows = await listMessages(conversationId);
  const files = await listMessageAttachments(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, attachments: files.get(row.id) }));
}

export async function insertMessage(
  conversationId: string,
  seq: number,
  data: AgentMessage,
  id: string = randomUUID(),
  tx: DbExecutor = db,
) {
  await tx.insert(message).values({ id, conversationId, seq, role: data.role, data });
  return id;
}

/** Deletes every message with `seq >= fromSeq` (used by regenerate). */
export async function deleteMessagesFrom(
  conversationId: string,
  fromSeq: number,
  tx: DbExecutor = db,
) {
  await tx
    .delete(message)
    .where(and(eq(message.conversationId, conversationId), gte(message.seq, fromSeq)));
}

/**
 * Creates a new conversation containing the history up to and including the UI message
 * `uiMessageId` (a whole assistant turn when it is an assistant message).
 * The sandbox workspace is copied too, so files created so far stay available.
 */
export async function forkConversation(userId: string, sourceId: string, uiMessageId: string) {
  const forkId = randomUUID();
  await db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(conversation)
      .where(ownedBy(userId, sourceId))
      .for("update");
    if (!source) throw new NotFoundError();
    const rows = await listMessages(sourceId, tx);
    const end = findTurnEnd(rows, uiMessageId);
    if (end === -1) throw new NotFoundError("Message");
    const history = rows.slice(0, end + 1);
    const files = await listMessageAttachments(
      tx,
      history.map((row) => row.id),
    );
    await tx.insert(conversation).values({
      id: forkId,
      userId,
      title: `${source.title} (fork)`,
      forkedFromId: sourceId,
    });
    const copies = history.map((row) => ({
      id: randomUUID(),
      conversationId: forkId,
      seq: row.seq,
      role: row.data.role,
      data: row.data,
    }));
    await tx.insert(message).values(copies);
    const references = history.flatMap((row, index) =>
      (files.get(row.id) ?? []).map((file, position) => ({
        messageId: copies[index]!.id,
        attachmentId: file.id,
        position,
      })),
    );
    if (references.length) await tx.insert(messageAttachment).values(references);
  });

  await sandboxManager
    .copyWorkspace(sourceId, forkId)
    .catch((error) => console.error("sandbox workspace copy failed", error));
  return forkId;
}
