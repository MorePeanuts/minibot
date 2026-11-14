import { Type } from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";
import { createMiniBotAgent } from "./agent";
import type { ChatModelConfig } from "./models";
import { generateTitle } from "./title";

const chat = {
  provider: "responses",
  modelId: "relay/arbitrary-model",
  baseUrl: "https://relay.example.test/team/v1",
  apiKey: "test-relay-key",
  reasoning: false,
} satisfies ChatModelConfig;

function respond(id: string, item: object, delta: object) {
  const events = [
    { type: "response.created", response: { id } },
    { type: "response.output_item.added", output_index: 0, item },
    { output_index: 0, ...delta },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id, status: "completed", output: [item] } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function textResponse(value: string) {
  return respond(
    "resp_text",
    {
      type: "message",
      id: "msg_text",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: value, annotations: [] }],
    },
    { type: "response.output_text.delta", delta: value },
  );
}

afterEach(() => vi.unstubAllGlobals());

it("streams text and round-trips a tool call without a DeepSeek key", async () => {
  const requests: { input: unknown[]; tools?: { name: string }[]; reasoning?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(`${chat.baseUrl}/responses`);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${chat.apiKey}`);
      expect(init?.redirect).toBe("error");
      const payload = JSON.parse(String(init?.body));
      expect(payload).toMatchObject({ model: chat.modelId, stream: true, store: false });
      expect(payload).not.toHaveProperty("reasoning");
      expect(payload).not.toHaveProperty("max_output_tokens");
      requests.push(payload);
      if (requests.length > 1) return textResponse("Tool says pong");
      const item = {
        type: "function_call",
        id: "fc_ping",
        call_id: "call_ping",
        name: "ping",
        arguments: '{"value":"ping"}',
        status: "completed",
      };
      return respond("resp_tool", item, {
        type: "response.function_call_arguments.done",
        arguments: item.arguments,
      });
    }),
  );
  const agent = createMiniBotAgent({
    chat,
    thinkingLevel: "max",
    history: [{ role: "user", content: "Use the tool", timestamp: 1 }],
    getSandbox: () => Promise.reject(new Error("No sandbox expected")),
  });
  expect(agent.state.tools.map(({ name }) => name)).not.toContain("web_search");
  expect(agent.state.systemPrompt).not.toContain("web_search");
  const execute = vi.fn(async (_id: string, _args: unknown) => ({
    content: [{ type: "text" as const, text: "pong" }],
    details: {},
  }));
  agent.state.tools = [
    ...agent.state.tools,
    {
      name: "ping",
      label: "Ping",
      description: "Replies with pong",
      parameters: Type.Object({ value: Type.String() }),
      execute,
    },
  ];
  const deltas: string[] = [];
  agent.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      deltas.push(event.assistantMessageEvent.delta);
    }
  });
  await agent.continue();

  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]).toEqual(expect.arrayContaining([{ value: "ping" }]));
  expect(requests).toHaveLength(2);
  expect(requests[0]?.tools).toContainEqual(expect.objectContaining({ name: "ping" }));
  expect(requests[1]?.input).toContainEqual({
    type: "function_call_output",
    call_id: "call_ping",
    output: "pong",
  });
  expect(deltas.join("")).toBe("Tool says pong");
});

it("generates titles with the selected relay and keeps request configuration separate", async () => {
  const other = {
    ...chat,
    baseUrl: "https://other.example.test/v1",
    apiKey: "other-relay-key",
    reasoning: true,
  };
  const fetchMock = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const config = String(input) === `${chat.baseUrl}/responses` ? chat : other;
    expect(String(input)).toBe(`${config.baseUrl}/responses`);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${config.apiKey}`);
    const payload = JSON.parse(String(init?.body));
    expect(payload.model).toBe(config.modelId);
    expect(payload.input[0].content).toContain("You name chat conversations");
    expect(payload).not.toHaveProperty("reasoning");
    return textResponse(config === chat ? "First title" : "Second title");
  });
  vi.stubGlobal("fetch", fetchMock);

  expect(await Promise.all([generateTitle(chat, "First"), generateTitle(other, "Second")])).toEqual(
    ["First title", "Second title"],
  );
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
