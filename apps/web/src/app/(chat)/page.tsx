import { randomUUID } from "node:crypto";
import { Chat } from "@/components/chat/chat";
import { ChatHeader } from "@/components/chat/chat-header";
import { getPublicSettings } from "@/server/services/settings";
import { requireUser } from "@/server/session";

export default async function NewChatPage() {
  const user = await requireUser();
  const settings = await getPublicSettings(user.id);
  // The id is generated up-front; the conversation row is created with the first message.
  const id = randomUUID();

  return (
    <>
      <ChatHeader title="New chat" model={settings.model} />
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        isNew
        hasApiKey={Boolean(settings.maskedApiKey || settings.hasServerKey)}
      />
    </>
  );
}
