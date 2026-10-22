import type { AgentEvent, AssistantMessage } from "@minibot/agent";
import { describe, expect, it } from "vitest";
import { createEventMapper, type MiniBotChunk } from "./event-mapper";

const partial = (content: AssistantMessage["content"]) =>
  ({ role: "assistant", content, stopReason: "pending" }) as unknown as AssistantMessage;

function run(events: AgentEvent[]) {
  const chunks: MiniBotChunk[] = [];
  const handle = createEventMapper((c) => chunks.push(c));
  events.forEach(handle);
  return chunks;
}

describe("createEventMapper", () => {
  it("maps streamed text and reasoning to UI chunks with stable part ids", () => {
    const msg = partial([]);
    const chunks = run([
      { type: "message_start", message: msg },
      {
        type: "message_update",
        message: msg,
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: msg },
      },
      {
        type: "message_update",
        message: msg,
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "hmm",
          partial: msg,
        },
      },
      {
        type: "message_update",
        message: msg,
        assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Hi", partial: msg },
      },
      { type: "message_end", message: { ...msg, stopReason: "stop" } as AssistantMessage },
    ]);
    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "reasoning-start", id: "0:0" },
      { type: "reasoning-delta", id: "0:0", delta: "hmm" },
      { type: "text-delta", id: "0:1", delta: "Hi" },
      { type: "finish-step" },
    ]);
  });

  it("maps tool calls and their (preliminary) results as dynamic tools", () => {
    const call = {
      type: "toolCall" as const,
      id: "c1",
      name: "bash",
      arguments: { command: "ls" },
    };
    const msg = partial([call]);
    const chunks = run([
      { type: "message_start", message: msg },
      {
        type: "message_update",
        message: msg,
        assistantMessageEvent: { type: "toolcall_start", contentIndex: 0, partial: msg },
      },
      {
        type: "message_update",
        message: msg,
        assistantMessageEvent: {
          type: "toolcall_end",
          contentIndex: 0,
          toolCall: call,
          partial: msg,
        },
      },
      {
        type: "tool_execution_update",
        toolCallId: "c1",
        toolName: "bash",
        args: {},
        partialResult: { content: [{ type: "text", text: "a" }], details: undefined },
      },
      {
        type: "tool_execution_end",
        toolCallId: "c1",
        toolName: "bash",
        result: { content: [{ type: "text", text: "boom" }], details: undefined },
        isError: true,
      },
    ] as AgentEvent[]);

    expect(chunks).toEqual([
      { type: "start-step" },
      { type: "tool-input-start", toolCallId: "c1", toolName: "bash", dynamic: true },
      {
        type: "tool-input-available",
        toolCallId: "c1",
        toolName: "bash",
        input: { command: "ls" },
        dynamic: true,
      },
      {
        type: "tool-output-available",
        toolCallId: "c1",
        output: { text: "a", details: undefined },
        dynamic: true,
        preliminary: true,
      },
      { type: "tool-output-error", toolCallId: "c1", errorText: "boom", dynamic: true },
    ]);
  });

  it("emits a data-error part when the model call fails", () => {
    const failed = { ...partial([]), stopReason: "error", errorMessage: "quota exceeded" };
    const chunks = run([{ type: "message_end", message: failed as AssistantMessage }]);
    expect(chunks).toEqual([
      { type: "data-error", data: { message: "quota exceeded" } },
      { type: "finish-step" },
    ]);
  });
});
