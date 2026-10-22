"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { toast } from "sonner";
import type { MiniBotUIMessage } from "@/lib/chat/types";
import { ChatComposer } from "./chat-composer";
import { ChatEmptyState } from "./chat-empty-state";
import { MessageList } from "./message-list";

interface ChatProps {
  id: string;
  initialMessages: MiniBotUIMessage[];
  /** True for a not-yet-persisted chat at "/". */
  isNew?: boolean;
  hasApiKey: boolean;
}

function textOf(message: MiniBotUIMessage) {
  return message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** Server errors come back as JSON `{ error }`; show the human readable part. */
function errorMessage(error: Error) {
  try {
    return (JSON.parse(error.message) as { error?: string }).error ?? error.message;
  } catch {
    return error.message;
  }
}

export function Chat({ id, initialMessages, isNew = false, hasApiKey }: ChatProps) {
  const router = useRouter();

  const transport = useMemo(
    () =>
      new DefaultChatTransport<MiniBotUIMessage>({
        api: "/api/chat",
        // The server owns the history; only send what changed.
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => {
          if (trigger === "submit-message") {
            const last = messages.at(-1)!;
            return {
              body: { trigger, conversationId: id, message: { id: last.id, text: textOf(last) } },
            };
          }
          return { body: { trigger, conversationId: id, messageId } };
        },
      }),
    [],
  );

  const { messages, sendMessage, regenerate, stop, status } = useChat<MiniBotUIMessage>({
    id,
    messages: initialMessages,
    transport,
    generateId: () => crypto.randomUUID(),
    // Refresh server components (sidebar ordering, generated title).
    onFinish: () => router.refresh(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const busy = status === "submitted" || status === "streaming";

  const handleSubmit = (text: string) => {
    if (!hasApiKey) {
      toast.error("Add your DeepSeek API key in Settings first.");
      return;
    }
    if (isNew && messages.length === 0) {
      // Give the chat its permanent URL without a navigation (keeps the stream alive).
      window.history.replaceState(null, "", `/c/${id}`);
    }
    void sendMessage({ text });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <ChatEmptyState onPick={handleSubmit} />
      ) : (
        <MessageList
          conversationId={id}
          messages={messages}
          status={status}
          onRegenerate={(messageId) => void regenerate({ messageId })}
        />
      )}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <ChatComposer busy={busy} onSubmit={handleSubmit} onStop={() => void stop()} />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          MiniBot can make mistakes. Commands run in an isolated sandbox.
        </p>
      </div>
    </div>
  );
}
