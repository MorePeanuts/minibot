"use client";

import { ArrowUp, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  busy: boolean;
  onSubmit: (text: string) => void;
  onStop: () => void;
}

export function ChatComposer({ busy, onSubmit, onStop }: ChatComposerProps) {
  const [value, setValue] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = value.trim();
    if (!text || busy) return;
    onSubmit(text);
    setValue("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline. Ignore Enter while an IME
    // (e.g. Chinese/Japanese input) is composing a word.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className="rounded-3xl border bg-background p-2 shadow-sm transition focus-within:ring-2 focus-within:ring-ring/30"
    >
      <TextareaAutosize
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask MiniBot anything…"
        minRows={1}
        maxRows={10}
        className="w-full resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
      <div className="flex items-center justify-end px-1">
        {busy ? (
          <Button
            type="button"
            size="icon"
            className="rounded-full"
            onClick={onStop}
            aria-label="Stop"
          >
            <Square className="size-3.5 fill-current" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={!value.trim()}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
