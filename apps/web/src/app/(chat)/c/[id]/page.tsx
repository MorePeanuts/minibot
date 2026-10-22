import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { Chat } from "@/components/chat/chat";
import { ChatHeader } from "@/components/chat/chat-header";
import { toUIMessages } from "@/lib/chat/ui-messages";
import { getConversation, listMessages } from "@/server/services/conversations";
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
    conversation ? listMessages(id) : Promise.resolve([]),
    getPublicSettings(user.id),
  ]);
  // A brand-new chat whose first message is still streaming has no row yet.
  if (!conversation && rows.length > 0) notFound();

  return (
    <>
      <ChatHeader
        title={conversation?.title ?? "New chat"}
        model={settings.model}
        archived={Boolean(conversation?.archivedAt)}
      />
      <Chat
        key={id}
        id={id}
        initialMessages={toUIMessages(rows)}
        hasApiKey={Boolean(settings.maskedApiKey || settings.hasServerKey)}
      />
    </>
  );
}
