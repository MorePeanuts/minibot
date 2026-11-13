import type { TranscriptContext, UserMessage } from "@earendil-works/pi-ai";

/** Local metadata on the user turn, serialized to native DeepSeek content blocks. */
export type FileUserMessage = UserMessage & { providerFileIds?: readonly string[] };

export function addFileContent(payload: unknown, context: TranscriptContext) {
  if (
    !payload ||
    typeof payload !== "object" ||
    !("messages" in payload) ||
    !Array.isArray(payload.messages)
  ) {
    throw new Error("Unexpected DeepSeek request format.");
  }
  const users = context.messages.filter(
    (message): message is FileUserMessage => message.role === "user",
  );
  const userParams = (payload.messages as { role: string; content?: unknown }[]).filter(
    (message) => message.role === "user",
  );
  if (users.length !== userParams.length)
    throw new Error("Could not match DeepSeek file references to user turns.");
  for (const [index, user] of users.entries()) {
    if (!user.providerFileIds?.length) continue;
    const param = userParams[index]!;
    const blocks =
      typeof param.content === "string"
        ? param.content
          ? [{ type: "text", text: param.content }]
          : []
        : Array.isArray(param.content)
          ? param.content
          : [];
    param.content = [
      ...blocks,
      ...user.providerFileIds.map((file_id) => ({ type: "file", file_id })),
    ];
  }
  return payload;
}
