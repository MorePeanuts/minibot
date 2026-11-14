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
      <ChatHeader
        provider={settings.chatProvider}
        title="New chat"
        model={
          settings.chatProvider === "responses"
            ? (settings.responsesModel ?? "Custom Responses")
            : settings.model
        }
      />
      <Chat
        key={id}
        id={id}
        initialMessages={[]}
        isNew
        hasApiKey={settings.hasChatCredentials}
        hasDeepSeekKey={settings.hasDeepSeekCredentials}
        provider={settings.chatProvider}
      />
    </>
  );
}
