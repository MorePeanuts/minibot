import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Chat } from "@/components/chat/chat";
import { ChatHeader } from "@/components/chat/chat-header";
import { toUIMessages } from "@/lib/chat/ui-messages";
import { getConversation, listMessagesWithAttachments } from "@/server/services/conversations";
import { getPublicSettings } from "@/server/services/settings";
import { requireUser } from "@/server/session";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function load(params: PageProps["params"]) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const user = await requireUser();
  const conversation = await getConversation(user.id, id);
  return { user, conversation };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { conversation } = await load(params);
  return { title: conversation?.title ?? "Chat" };
}

export default async function ConversationPage({ params }: PageProps) {
  const { id } = await params;
  const { user, conversation } = await load(params);
  const [rows, settings] = await Promise.all([
    conversation ? listMessagesWithAttachments(id) : Promise.resolve([]),
    getPublicSettings(user.id),
  ]);
  // A brand-new chat whose first message is still streaming has no row yet.
  if (!conversation && rows.length > 0) notFound();

  return (
    <>
      <ChatHeader
        provider={settings.chatProvider}
        title={conversation?.title ?? "New chat"}
        model={
          settings.chatProvider === "responses"
            ? (settings.responsesModel ?? "Custom Responses")
            : rows.some((row) => row.attachments?.length)
              ? "deepseek-flash"
              : settings.model
        }
        archived={Boolean(conversation?.archivedAt)}
      />
      <Chat
        key={id}
        id={id}
        initialMessages={toUIMessages(rows, id)}
        hasApiKey={settings.hasChatCredentials}
        hasDeepSeekKey={settings.hasDeepSeekCredentials}
        provider={settings.chatProvider}
      />
    </>
  );
}
