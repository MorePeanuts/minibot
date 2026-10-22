/**
 * Translates pi-agent events into AI SDK "UI message stream" chunks, so the
 * frontend can use the stock `useChat` hook while the backend runs a pi Agent.
 *
 *   pi AgentEvent ──▶ mapper ──▶ UIMessageChunk ──▶ SSE ──▶ useChat()
 */
import type { AgentEvent } from "@minibot/agent";
import type { InferUIMessageChunk } from "ai";
import { contentToText } from "@/lib/chat/ui-messages";
import type { MiniBotUIMessage, ToolOutput } from "@/lib/chat/types";

export type MiniBotChunk = InferUIMessageChunk<MiniBotUIMessage>;

export function createEventMapper(write: (chunk: MiniBotChunk) => void) {
  /** Index of the assistant message within the run; namespaces text/reasoning part ids. */
  let step = -1;
  const startedToolCalls = new Set<string>();
  const partId = (contentIndex: number) => `${step}:${contentIndex}`;

  return function handle(event: AgentEvent) {
    switch (event.type) {
      case "message_start":
        if (event.message.role === "assistant") {
          step++;
          write({ type: "start-step" });
        }
        return;

      case "message_update": {
        const e = event.assistantMessageEvent;
        switch (e.type) {
          case "text_start":
            return write({ type: "text-start", id: partId(e.contentIndex) });
          case "text_delta":
            return write({ type: "text-delta", id: partId(e.contentIndex), delta: e.delta });
          case "text_end":
            return write({ type: "text-end", id: partId(e.contentIndex) });
          case "thinking_start":
            return write({ type: "reasoning-start", id: partId(e.contentIndex) });
          case "thinking_delta":
            return write({ type: "reasoning-delta", id: partId(e.contentIndex), delta: e.delta });
          case "thinking_end":
            return write({ type: "reasoning-end", id: partId(e.contentIndex) });
          case "toolcall_start": {
            const block = e.partial.content[e.contentIndex];
            if (block?.type === "toolCall" && block.id && block.name) {
              startedToolCalls.add(block.id);
              write({
                type: "tool-input-start",
                toolCallId: block.id,
                toolName: block.name,
                dynamic: true,
              });
            }
            return;
          }
          case "toolcall_delta": {
            const block = e.partial.content[e.contentIndex];
            if (block?.type === "toolCall" && startedToolCalls.has(block.id)) {
              write({ type: "tool-input-delta", toolCallId: block.id, inputTextDelta: e.delta });
            }
            return;
          }
          case "toolcall_end":
            return write({
              type: "tool-input-available",
              toolCallId: e.toolCall.id,
              toolName: e.toolCall.name,
              input: e.toolCall.arguments,
              dynamic: true,
            });
          default:
            return;
        }
      }

      case "message_end": {
        const message = event.message;
        if (message.role !== "assistant") return;
        if (message.stopReason === "error") {
          write({
            type: "data-error",
            data: { message: message.errorMessage ?? "The model returned an error" },
          });
        }
        return write({ type: "finish-step" });
      }

      case "tool_execution_update":
      case "tool_execution_end": {
        const result = event.type === "tool_execution_end" ? event.result : event.partialResult;
        const text = contentToText(result?.content ?? []);
        if (event.type === "tool_execution_end" && event.isError) {
          return write({
            type: "tool-output-error",
            toolCallId: event.toolCallId,
            errorText: text,
            dynamic: true,
          });
        }
        return write({
          type: "tool-output-available",
          toolCallId: event.toolCallId,
          output: { text, details: result?.details } satisfies ToolOutput,
          dynamic: true,
          preliminary: event.type === "tool_execution_update",
        });
      }

      default:
        return;
    }
  };
}
