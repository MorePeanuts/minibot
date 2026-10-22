import type { AgentMessage } from "@minibot/agent";
import { describe, expect, it } from "vitest";
import { findTurnEnd, type StoredMessage, toUIMessages } from "./ui-messages";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const assistant = (
  content: Extract<AgentMessage, { role: "assistant" }>["content"],
  extra: Partial<Extract<AgentMessage, { role: "assistant" }>> = {},
): AgentMessage => ({
  role: "assistant",
  content,
  api: "openai-completions",
  provider: "deepseek",
  model: "deepseek-flash",
  usage,
  stopReason: "stop",
  timestamp: 0,
  ...extra,
});

const rows: StoredMessage[] = [
  { id: "u1", data: { role: "user", content: "list files", timestamp: 0 } },
  {
    id: "a1",
    data: assistant(
      [
        { type: "thinking", thinking: "I should run ls" },
        { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "ls" } },
      ],
      { stopReason: "toolUse" },
    ),
  },
  {
    id: "t1",
    data: {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "a.txt" }],
      isError: false,
      timestamp: 0,
    },
  },
  { id: "a2", data: assistant([{ type: "text", text: "There is a.txt" }]) },
  { id: "u2", data: { role: "user", content: "thanks", timestamp: 0 } },
  {
    id: "a3",
    data: assistant([], { stopReason: "error", errorMessage: "401 invalid key" }),
  },
];

describe("toUIMessages", () => {
  const messages = toUIMessages(rows);

  it("groups a multi-step agent turn into one assistant UI message", () => {
    expect(messages.map((m) => [m.role, m.id])).toEqual([
      ["user", "u1"],
      ["assistant", "a1"],
      ["user", "u2"],
      ["assistant", "a3"],
    ]);
  });

  it("merges tool results into their tool call part", () => {
    const parts = messages[1]!.parts;
    expect(parts.map((p) => p.type)).toEqual([
      "step-start",
      "reasoning",
      "dynamic-tool",
      "step-start",
      "text",
    ]);
    expect(parts[2]).toMatchObject({
      type: "dynamic-tool",
      toolName: "bash",
      state: "output-available",
      input: { command: "ls" },
      output: { text: "a.txt" },
    });
  });

  it("surfaces provider errors as data-error parts", () => {
    expect(messages[3]!.parts).toContainEqual({
      type: "data-error",
      data: { message: "401 invalid key" },
    });
  });
});

describe("findTurnEnd", () => {
  it("returns the user row itself for user messages", () => {
    expect(findTurnEnd(rows, "u1")).toBe(0);
  });

  it("extends an assistant turn until the next user message", () => {
    expect(findTurnEnd(rows, "a1")).toBe(3);
    expect(findTurnEnd(rows, "a3")).toBe(5);
  });

  it("returns -1 for unknown ids", () => {
    expect(findTurnEnd(rows, "nope")).toBe(-1);
  });
});
