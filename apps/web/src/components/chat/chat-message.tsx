"use client";

import { AlertCircle, Check, Copy, GitBranch, RefreshCw } from "lucide-react";
import { memo, useState, useTransition } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import { forkConversationAction } from "@/actions/conversations";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { MiniBotUIMessage } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import { Reasoning } from "./reasoning";
import { ToolCall } from "./tool-call";

interface ChatMessageProps {
  conversationId: string;
  message: MiniBotUIMessage;
  isStreaming: boolean;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

function ActionButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function MessageActions({
  conversationId,
  message,
  canRegenerate,
  onRegenerate,
}: Omit<ChatMessageProps, "isStreaming">) {
  const [copied, setCopied] = useState(false);
  const [forking, startFork] = useTransition();
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n\n");

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fork = () =>
    startFork(async () => {
      try {
        await forkConversationAction(conversationId, message.id);
      } catch (error) {
        // redirect() inside the action throws a special error that Next handles itself.
        if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
        toast.error("Could not fork from this message. Try again after the reply has finished.");
      }
    });

  return (
    <div
      className={cn(
        "flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        message.role === "user" && "justify-end",
      )}
    >
      <ActionButton label={copied ? "Copied" : "Copy"} onClick={copy}>
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </ActionButton>
      {canRegenerate && (
        <ActionButton label="Regenerate" onClick={onRegenerate}>
          <RefreshCw className="size-3.5" />
        </ActionButton>
      )}
      <ActionButton label="Fork into new chat" onClick={fork} disabled={forking}>
        <GitBranch className="size-3.5" />
      </ActionButton>
    </div>
  );
}

export const ChatMessage = memo(function ChatMessage(props: ChatMessageProps) {
  const { message, isStreaming } = props;

  if (message.role === "user") {
    const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("");
    return (
      <div data-role="user" className="group flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-3xl bg-muted px-4 py-2.5 whitespace-pre-wrap">
          {text}
        </div>
        <MessageActions {...props} />
      </div>
    );
  }

  return (
    <div data-role="assistant" className="group flex flex-col gap-2">
      {message.parts.map((part, index) => {
        const key = `${message.id}-${index}`;
        switch (part.type) {
          case "text":
            return (
              <Streamdown key={key} isAnimating={isStreaming && part.state === "streaming"}>
                {part.text}
              </Streamdown>
            );
          case "reasoning":
            return <Reasoning key={key} text={part.text} streaming={part.state === "streaming"} />;
          case "dynamic-tool":
            return <ToolCall key={key} part={part} />;
          case "data-error":
            return (
              <div
                key={key}
                className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span className="break-words">{part.data.message}</span>
              </div>
            );
          default:
            return null;
        }
      })}
      {!isStreaming && <MessageActions {...props} />}
    </div>
  );
});
