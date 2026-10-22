/**
 * Converts persisted pi-agent messages into AI SDK UI messages.
 *
 * One UI "assistant" message groups every assistant / toolResult row of a turn
 * (multiple LLM steps + tool executions) — exactly how `useChat` renders a live stream.
 * The UI message id is the id of the first DB row in the group, which makes it a
 * stable anchor for fork / regenerate.
 */
import type { AgentMessage } from "@minibot/agent";
import type { MiniBotUIMessage, ToolOutput } from "./types";

export interface StoredMessage {
  id: string;
  data: AgentMessage;
}

type Part = MiniBotUIMessage["parts"][number];

export function contentToText(content: string | readonly { type: string; text?: string }[]) {
  if (typeof content === "string") return content;
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

export function toUIMessages(rows: StoredMessage[]): MiniBotUIMessage[] {
  const result: MiniBotUIMessage[] = [];
  let current: MiniBotUIMessage | undefined;

  for (const { id, data } of rows) {
    if (data.role === "user") {
      current = undefined;
      result.push({
        id,
        role: "user",
        parts: [{ type: "text", text: contentToText(data.content) }],
      });
      continue;
    }

    if (data.role === "assistant") {
      if (!current) {
        current = { id, role: "assistant", parts: [] };
        result.push(current);
      }
      current.parts.push({ type: "step-start" });
      for (const block of data.content) {
        if (block.type === "thinking" && block.thinking) {
          current.parts.push({ type: "reasoning", text: block.thinking, state: "done" });
        } else if (block.type === "text" && block.text) {
          current.parts.push({ type: "text", text: block.text, state: "done" });
        } else if (block.type === "toolCall") {
          current.parts.push({
            type: "dynamic-tool",
            toolName: block.name,
            toolCallId: block.id,
            state: "input-available",
            input: block.arguments,
          });
        }
      }
      if (data.stopReason === "error") {
        current.parts.push({
          type: "data-error",
          data: { message: data.errorMessage ?? "The model returned an error" },
        });
      }
      continue;
    }

    if (data.role === "toolResult" && current) {
      const index = current.parts.findIndex(
        (p) => p.type === "dynamic-tool" && p.toolCallId === data.toolCallId,
      );
      const call = current.parts[index];
      if (!call || call.type !== "dynamic-tool") continue;
      const text = contentToText(data.content);
      const base = {
        type: "dynamic-tool",
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        input: call.input,
      } as const;
      const updated: Part = data.isError
        ? { ...base, state: "output-error", errorText: text }
        : {
            ...base,
            state: "output-available",
            output: { text, details: data.details } satisfies ToolOutput,
          };
      current.parts[index] = updated;
    }
  }
  return result;
}

/**
 * Index (inclusive) of the last stored row that belongs to the UI message `uiMessageId`.
 * A user message is a single row; an assistant UI message extends until the next user row.
 * Returns -1 when the id is unknown.
 */
export function findTurnEnd(rows: { id: string; data: { role: string } }[], uiMessageId: string) {
  const start = rows.findIndex((r) => r.id === uiMessageId);
  if (start === -1) return -1;
  if (rows[start]!.data.role === "user") return start;
  let end = start;
  while (end + 1 < rows.length && rows[end + 1]!.data.role !== "user") end++;
  return end;
}
