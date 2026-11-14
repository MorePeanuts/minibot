"use client";

import type { ChatProvider } from "@minibot/agent/catalog";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useRouter } from "next/navigation";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { attachmentUrl, type AttachmentInfo } from "@/lib/chat/attachments";
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
  hasDeepSeekKey: boolean;
  provider: ChatProvider;
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

export function Chat({
  id,
  initialMessages,
  isNew = false,
  hasApiKey,
  hasDeepSeekKey,
  provider,
}: ChatProps) {
  const router = useRouter();

  const retryTurn = useRef<string | null>(null);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<MiniBotUIMessage>({
        api: "/api/chat",
        // The server owns the history; only send what changed.
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId, body }) => {
          if (trigger === "submit-message") {
            const last = messages.at(-1)!;
            return {
              body: {
                trigger,
                conversationId: id,
                message: {
                  id: last.id,
                  text: textOf(last),
                  attachmentIds: body?.attachmentIds ?? [],
                },
              },
            };
          }
          return { body: { trigger, conversationId: id, messageId } };
        },
      }),
    [],
  );

  const { messages, setMessages, sendMessage, regenerate, stop, status } =
    useChat<MiniBotUIMessage>({
      id,
      messages: initialMessages,
      transport,
      generateId: () => crypto.randomUUID(),
      // Refresh server components (sidebar ordering, generated title).
      onFinish: ({ isError, isDisconnect }) => {
        if (!isError && !isDisconnect) router.refresh();
      },
      onError: (error) => toast.error(errorMessage(error)),
    });

  const busy = status === "submitted" || status === "streaming";

  const handleSubmit = async (text: string, attachments: AttachmentInfo[] = []) => {
    if (!hasApiKey) {
      toast.error(
        provider === "responses"
          ? "Configure your Responses provider in Settings first."
          : "Add your DeepSeek API key in Settings first.",
      );
      return false;
    }
    if (isNew && messages.length === 0) {
      // Give the chat its permanent URL without a navigation (keeps the stream alive).
      window.history.replaceState(null, "", `/c/${id}`);
    }
    const attachmentIds = attachments.map((file) => file.id);
    const prior = retryTurn.current;

    const checkSaved = async (messageId: string) => {
      try {
        const params = new URLSearchParams({ conversationId: id, messageId });
        const response = await fetch(`/api/chat?${params}`, { method: "HEAD" });
        if (response.status === 204) return true;
        if (response.status === 404) return false;
      } catch {
        // Retry the status lookup with the same message ID on the next submit.
      }
      return null;
    };

    if (prior) {
      const saved = await checkSaved(prior);
      if (saved === null) {
        toast.error("Could not check whether the previous message was sent. Try again.");
        return false;
      }
      retryTurn.current = null;
      if (saved) {
        router.refresh();
        toast.info("The previous message was saved. Use Generate response to continue it.");
        return true;
      }
      setMessages((current) => current.filter((message) => message.id !== prior));
    }

    const messageId = prior ?? crypto.randomUUID();
    await sendMessage(
      {
        id: messageId,
        role: "user",
        parts: [
          ...attachments.map((file) => ({
            type: "file" as const,
            filename: file.filename,
            mediaType: file.mediaType,
            url: attachmentUrl(file.id, id),
          })),
          { type: "text", text },
        ],
      },
      { body: { attachmentIds } },
    );
    const saved = await checkSaved(messageId);
    if (saved) return true;
    if (saved === null) {
      retryTurn.current = messageId;
      toast.error("Could not check whether this message was saved. Send again to recheck.");
      return false;
    }
    setMessages((current) => current.filter((message) => message.id !== messageId));
    return false;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {messages.length === 0 ? (
        <ChatEmptyState onPick={(text) => void handleSubmit(text)} />
      ) : (
        <MessageList
          conversationId={id}
          messages={messages}
          status={status}
          canUseVoice={hasDeepSeekKey}
          onRegenerate={(messageId) => void regenerate({ messageId })}
        />
      )}
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <ChatComposer
          conversationId={id}
          canAttach={provider === "deepseek" && hasDeepSeekKey}
          canUseVoice={hasDeepSeekKey}
          busy={busy}
          onSubmit={handleSubmit}
          onStop={() => void stop()}
        />
        <p className="mt-2 text-center text-xs text-muted-foreground">
          MiniBot can make mistakes. Commands run in an isolated sandbox.
        </p>
      </div>
    </div>
  );
}
