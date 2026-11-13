import "server-only";
import { and, eq, schema, sql } from "@minibot/db";
import { db } from "../db";

export async function findWorkspaceDownload(userId: string, conversationId: string, id: string) {
  const { conversation, message } = schema;
  const [row] = await db
    .select({ filename: sql<string>`${message.data} #>> '{details,download,filename}'` })
    .from(message)
    .innerJoin(conversation, eq(message.conversationId, conversation.id))
    .where(
      and(
        eq(conversation.id, conversationId),
        eq(conversation.userId, userId),
        eq(message.role, "toolResult"),
        sql`${message.data}->>'toolName' = 'export_file'`,
        sql`${message.data}->>'isError' = 'false'`,
        sql`${message.data} #>> '{details,download,id}' = ${id}`,
      ),
    )
    .limit(1);
  return row?.filename ?? null;
}
