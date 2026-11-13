"use client";

import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import Image from "next/image";
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import TextareaAutosize from "react-textarea-autosize";
import { toast } from "sonner";
import {
  attachmentUrl,
  documentAccept,
  documentPurpose,
  maxDocumentSize,
  imageAccept,
  isImageMediaType,
  maxDocuments,
  maxImages,
  maxImageSize,
  type AttachmentInfo,
} from "@/lib/chat/attachments";
import { Button } from "@/components/ui/button";

interface ChatComposerProps {
  busy: boolean;
  conversationId: string;
  hasApiKey: boolean;
  onSubmit: (text: string, attachments: AttachmentInfo[]) => Promise<boolean>;
  onStop: () => void;
}

export function ChatComposer({
  busy,
  conversationId,
  hasApiKey,
  onSubmit,
  onStop,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<AttachmentInfo[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [richLayout, setRichLayout] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const imageCount = attachments.filter((file) => isImageMediaType(file.mediaType)).length;
  const upload = async (files: File[], pasted = false) => {
    if (!hasApiKey || uploading.current || pending || busy || sending || !files.length) return;
    uploading.current = true;
    let images = imageCount;
    let documents = attachments.length - images;
    try {
      for (const file of files) {
        const image =
          pasted ||
          file.type.startsWith("image/") ||
          imageAccept.split(",").some((extension) => file.name.toLowerCase().endsWith(extension));
        const filename = file.name || "Screenshot";
        if (!image && !documentPurpose(filename, richLayout)) {
          toast.error(`${filename}: choose a supported document or JPEG, PNG, GIF, or WebP image.`);
          continue;
        }
        if (!file.size || file.size > (image ? maxImageSize : maxDocumentSize)) {
          toast.error(`${filename}: choose a file between 1 byte and 20 MiB.`);
          continue;
        }
        if (image ? images >= maxImages : documents >= maxDocuments) {
          toast.error(
            `Attach up to ${image ? `${maxImages} images` : `${maxDocuments} documents`} per chat.`,
          );
          continue;
        }
        setPending(filename);
        try {
          const params = new URLSearchParams({
            conversationId,
            filename,
            layout: richLayout ? "rich" : "text",
            kind: image ? "image" : "document",
          });
          const response = await fetch(`/api/attachments?${params}`, {
            method: "POST",
            body: file,
            headers: { "Content-Type": file.type || "application/octet-stream" },
          });
          if (!response.ok) throw new Error((await response.json()).error);
          const info = (await response.json()) as AttachmentInfo;
          if (isImageMediaType(info.mediaType)) images++;
          else documents++;
          setAttachments((current) => [...current, info]);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not upload attachment.");
        }
      }
    } finally {
      uploading.current = false;
      setPending(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.files).filter(
      (file) => file.type.startsWith("image/") || !file.type,
    );
    if (!images.length) return;
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
    if (!hasApiKey) toast.error("Add your DeepSeek API key in Settings first.");
    else if (busy || sending || pending || uploading.current) {
      toast.error("Wait for the current response or upload before pasting an image.");
    } else {
      void upload(images, true);
    }
  };

  const remove = async (file: AttachmentInfo) => {
    setPending(file.filename);
    try {
      const response = await fetch(attachmentUrl(file.id, conversationId), { method: "DELETE" });
      if (!response.ok && response.status !== 404) throw new Error();
      setAttachments((current) => current.filter((item) => item.id !== file.id));
    } catch {
      toast.error("Could not remove attachment. Try again.");
    } finally {
      setPending(null);
    }
  };

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = value.trim();
    if ((!text && !attachments.length) || busy || pending || uploading.current || sending) return;
    setSending(true);
    try {
      if (await onSubmit(text, attachments)) {
        setAttachments([]);
        setValue("");
      }
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter inserts a newline. Ignore Enter while an IME
    // (e.g. Chinese/Japanese input) is composing a word.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="rounded-3xl border bg-background p-2 shadow-sm transition focus-within:ring-2 focus-within:ring-ring/30"
    >
      <input
        type="file"
        ref={picker}
        hidden
        multiple
        accept={`${documentAccept},${imageAccept}`}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void upload(files);
        }}
      />
      {attachments.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2 px-3 pt-2">
          {attachments.map((file) => (
            <li
              key={file.id}
              className="flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-sm"
            >
              {isImageMediaType(file.mediaType) && (
                <Image
                  src={attachmentUrl(file.id, conversationId, true)}
                  alt={`Preview of ${file.filename}`}
                  width={48}
                  height={48}
                  unoptimized
                  className="size-12 rounded object-contain"
                />
              )}
              <span className="truncate" title={file.filename}>
                {file.filename}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={Boolean(pending) || sending}
                aria-label={`Remove ${file.filename}`}
                onClick={() => void remove(file)}
              >
                <X className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {imageCount > 0 && (
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          Images use DeepSeek Flash. Up to {maxImages} images per chat, 20 MiB each.
        </p>
      )}
      {pending && (
        <p role="status" className="px-3 pt-2 text-sm text-muted-foreground">
          Processing {pending}…
        </p>
      )}
      <TextareaAutosize
        autoFocus
        readOnly={sending}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder="Ask MiniBot anything…"
        minRows={1}
        maxRows={10}
        className="w-full resize-none bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
      />
      <div className="flex items-center gap-2 px-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Attach documents or images"
          title="Attach documents or images"
          disabled={busy || sending || Boolean(pending) || !hasApiKey}
          onClick={() => picker.current?.click()}
        >
          <Paperclip className="size-4" />
        </Button>
        {hasApiKey && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={richLayout}
              onChange={(event) => setRichLayout(event.target.checked)}
              disabled={busy || sending || Boolean(pending)}
            />
            Include document images
          </label>
        )}
        <div className="flex-1" />
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
            disabled={(!value.trim() && !attachments.length) || Boolean(pending) || sending}
            aria-label="Send"
          >
            <ArrowUp className="size-4" />
          </Button>
        )}
      </div>
    </form>
  );
}
