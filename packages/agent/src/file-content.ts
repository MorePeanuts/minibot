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

export type ResponsesAttachment =
  | { type: "input_file"; filename: string; file_data: string }
  | { type: "input_image"; image_url: string; detail: "auto" };

export function prepareFileContent(
  context: TranscriptContext,
  responses?: ReadonlyMap<string, ResponsesAttachment>,
) {
  const fileTurns = new Map<string, FileUserMessage>();
  const messages = context.messages.map((message) => {
    if (message.role !== "user") return message;
    if (responses ? !(message as FileUserMessage).localAttachments?.length : !hasFiles(message))
      return message;
    const marker = randomUUID();
    fileTurns.set(marker, message as FileUserMessage);
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
      const key = responses ? "input" : "messages";
      const textType = responses ? "input_text" : "text";
      const entries =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)[key]
          : undefined;
      if (!payload || typeof payload !== "object" || !Array.isArray(entries)) {
        throw new Error("Unexpected attachment request format.");
      }
      // Tool results with images can create extra provider-side user turns. Match the
      // attachment to its actual user turn using a marker removed before serialization.
      const matched = new Set<string>();
      for (const param of entries as { role: string; content?: unknown }[]) {
        if (param.role !== "user" || !Array.isArray(param.content)) continue;
        const [first, ...blocks] = param.content;
        if (first?.type !== textType) continue;
        const user = fileTurns.get(first.text);
        if (!user) continue;
        matched.add(first.text);
        param.content = [
          ...blocks,
          ...(user.localAttachments?.length
            ? [
                {
                  type: textType,
                  text: `Uploaded attachments (internal IDs for sandbox tools): ${JSON.stringify(user.localAttachments)}`,
                },
              ]
            : []),
          ...(responses
            ? user.localAttachments!.map(({ id }) => {
                const block = responses.get(id);
                if (!block) throw new Error("Missing original attachment.");
                return block;
              })
            : user.providerFileIds!.map((file_id) => ({ type: "file", file_id }))),
        ];
      }
      if (matched.size !== fileTurns.size) {
        throw new Error("Could not match attachment references to user turns.");
      }
      return payload;
    },
  };
}
