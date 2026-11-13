import { randomUUID } from "node:crypto";
import type { TranscriptContext, UserMessage } from "@earendil-works/pi-ai";

/** Local metadata on the user turn, serialized to native DeepSeek content blocks. */
export type FileUserMessage = UserMessage & {
  providerFileIds?: readonly string[];
  localAttachments?: readonly { id: string; filename: string }[];
};

function hasFiles(message: TranscriptContext["messages"][number]): message is FileUserMessage {
  return message.role === "user" && Boolean((message as FileUserMessage).providerFileIds?.length);
}

export function prepareFileContent(context: TranscriptContext) {
  const fileTurns = new Map<string, FileUserMessage>();
  const messages = context.messages.map((message) => {
    if (!hasFiles(message)) return message;
    const marker = randomUUID();
    fileTurns.set(marker, message);
    const content =
      typeof message.content === "string"
        ? message.content
          ? [{ type: "text" as const, text: message.content }]
          : []
        : message.content;
    return { ...message, content: [{ type: "text" as const, text: marker }, ...content] };
  });

  return {
    context: fileTurns.size ? { ...context, messages } : context,
    addToPayload(payload: unknown) {
      if (
        !payload ||
        typeof payload !== "object" ||
        !("messages" in payload) ||
        !Array.isArray(payload.messages)
      ) {
        throw new Error("Unexpected DeepSeek request format.");
      }
      // Tool results with images can create extra provider-side user turns. Match the
      // attachment to its actual user turn using a marker removed before serialization.
      const matched = new Set<string>();
      for (const param of payload.messages as { role: string; content?: unknown }[]) {
        if (param.role !== "user" || !Array.isArray(param.content)) continue;
        const [first, ...blocks] = param.content;
        if (first?.type !== "text") continue;
        const user = fileTurns.get(first.text);
        if (!user) continue;
        matched.add(first.text);
        param.content = [
          ...blocks,
          ...(user.localAttachments?.length
            ? [
                {
                  type: "text",
                  text: `Uploaded attachments (internal IDs for sandbox tools): ${JSON.stringify(user.localAttachments)}`,
                },
              ]
            : []),
          ...user.providerFileIds!.map((file_id) => ({ type: "file", file_id })),
        ];
      }
      if (matched.size !== fileTurns.size) {
        throw new Error("Could not match DeepSeek file references to user turns.");
      }
      return payload;
    },
  };
}
