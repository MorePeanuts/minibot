"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/server/session";
import * as conversations from "@/server/services/conversations";

const id = z.uuid();

export async function renameConversationAction(conversationId: string, title: string) {
  const user = await requireUser();
  await conversations.renameConversation(
    user.id,
    id.parse(conversationId),
    z.string().trim().min(1).max(120).parse(title),
  );
  revalidatePath("/", "layout");
}

export async function archiveConversationAction(conversationId: string, archived: boolean) {
  const user = await requireUser();
  await conversations.setConversationArchived(user.id, id.parse(conversationId), archived);
  revalidatePath("/", "layout");
}

export async function deleteConversationAction(conversationId: string) {
  const user = await requireUser();
  await conversations.deleteConversation(user.id, id.parse(conversationId));
  revalidatePath("/", "layout");
}

/** Forks the conversation at `messageId` and navigates to the new chat. */
export async function forkConversationAction(conversationId: string, messageId: string) {
  const user = await requireUser();
  const forkId = await conversations.forkConversation(
    user.id,
    id.parse(conversationId),
    id.parse(messageId),
  );
  revalidatePath("/", "layout");
  redirect(`/c/${forkId}`);
}

export async function listArchivedConversationsAction() {
  const user = await requireUser();
  return conversations.listConversations(user.id, { archived: true });
}
