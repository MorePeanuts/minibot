"use client";

import type { ChatStatus } from "ai";
import { ArrowDown } from "lucide-react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { Button } from "@/components/ui/button";
import type { MiniBotUIMessage } from "@/lib/chat/types";
import { ChatMessage } from "./chat-message";

interface MessageListProps {
  conversationId: string;
  messages: MiniBotUIMessage[];
  status: ChatStatus;
  onRegenerate: (messageId: string) => void;
}

function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      variant="outline"
      size="icon"
      className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
      onClick={() => void scrollToBottom()}
      aria-label="Scroll to bottom"
    >
      <ArrowDown className="size-4" />
    </Button>
  );
}

export function MessageList({ conversationId, messages, status, onRegenerate }: MessageListProps) {
  const busy = status === "submitted" || status === "streaming";
  const last = messages.at(-1);

  return (
    <StickToBottom
      className="relative min-h-0 flex-1 overflow-y-auto"
      resize="smooth"
      initial="instant"
    >
      <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            conversationId={conversationId}
            message={message}
            isStreaming={busy && index === messages.length - 1}
            canRegenerate={!busy && message.role === "assistant"}
            onRegenerate={() => onRegenerate(message.id)}
          />
        ))}
        {status === "submitted" && last?.role === "user" && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-muted-foreground" />
            Thinking…
          </div>
        )}
        {!busy && last?.role === "user" && (
          <div>
            <Button variant="outline" size="sm" onClick={() => onRegenerate(last.id)}>
              Generate response
            </Button>
          </div>
        )}
      </StickToBottom.Content>
      <ScrollToBottomButton />
    </StickToBottom>
  );
}
