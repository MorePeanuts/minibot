import "server-only";
import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@minibot/agent";
import { and, asc, desc, eq, gte, isNotNull, isNull, schema } from "@minibot/db";
import { findTurnEnd } from "@/lib/chat/ui-messages";
import { db } from "../db";
import { sandboxManager } from "../sandbox";

const { conversation, message } = schema;

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
  const rows = await db
    .delete(conversation)
    .where(ownedBy(userId, id))
    .returning({ id: conversation.id });
  if (rows.length === 0) throw new NotFoundError();
  await sandboxManager.remove(id).catch((error) => console.error("sandbox cleanup failed", error));
}

/** Marks a conversation as recently active (sidebar ordering). */
export async function touchConversation(id: string) {
  await db.update(conversation).set({ updatedAt: new Date() }).where(eq(conversation.id, id));
}

export function listMessages(conversationId: string) {
  return db
    .select({ id: message.id, seq: message.seq, data: message.data })
    .from(message)
    .where(eq(message.conversationId, conversationId))
    .orderBy(asc(message.seq));
}

export async function insertMessage(
  conversationId: string,
  seq: number,
  data: AgentMessage,
  id: string = randomUUID(),
) {
  await db.insert(message).values({ id, conversationId, seq, role: data.role, data });
  return id;
}

/** Deletes every message with `seq >= fromSeq` (used by regenerate). */
export async function deleteMessagesFrom(conversationId: string, fromSeq: number) {
  await db
    .delete(message)
    .where(and(eq(message.conversationId, conversationId), gte(message.seq, fromSeq)));
}

/**
 * Creates a new conversation containing the history up to and including the UI message
 * `uiMessageId` (a whole assistant turn when it is an assistant message).
 * The sandbox workspace is copied too, so files created so far stay available.
 */
export async function forkConversation(userId: string, sourceId: string, uiMessageId: string) {
  const source = await getConversation(userId, sourceId);
  if (!source) throw new NotFoundError();

  const rows = await listMessages(sourceId);
  const end = findTurnEnd(rows, uiMessageId);
  if (end === -1) throw new NotFoundError("Message");

  const forkId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(conversation).values({
      id: forkId,
      userId,
      title: `${source.title} (fork)`,
      forkedFromId: sourceId,
    });
    await tx.insert(message).values(
      rows.slice(0, end + 1).map((row) => ({
        conversationId: forkId,
        seq: row.seq,
        role: row.data.role,
        data: row.data,
      })),
    );
  });

  await sandboxManager
    .copyWorkspace(sourceId, forkId)
    .catch((error) => console.error("sandbox workspace copy failed", error));
  return forkId;
}
