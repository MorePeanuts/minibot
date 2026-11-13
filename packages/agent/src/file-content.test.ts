import { afterEach, expect, it, vi } from "vitest";
import { createMiniBotAgent } from "./agent";
import { uploadDeepSeekFile } from "./deepseek-files";
import type { FileUserMessage } from "./file-content";

afterEach(() => vi.unstubAllGlobals());

it("submits the parser purpose before the document", async () => {
  const file = new File(["PDF"], "report.pdf", { type: "application/pdf" });
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["purpose", "file"]);
    expect(form.get("purpose")).toBe("rich_layout_recognition");
    expect(await (form.get("file") as File).text()).toBe("PDF");
    return Response.json({ id: "file-api-report" });
  });
  vi.stubGlobal("fetch", fetchMock);
  await expect(uploadDeepSeekFile("mock", file, "rich_layout_recognition")).resolves.toBe(
    "file-api-report",
  );
});

it("replays native file references on both requests of a streamed tool turn", async () => {
  interface Payload {
    model: string;
    stream: boolean;
    messages: { role: string; content: unknown }[];
  }
  const requests: Payload[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const { url } = input instanceof Request ? input : new Request(input);
    if (url.includes("/tools/search")) return Response.json({ results: [] });
    const payload =
      input instanceof Request
        ? ((await input.json()) as Payload)
        : (JSON.parse(String(init?.body)) as Payload);
    requests.push(payload);
    const delta =
      requests.length === 1
        ? {
            tool_calls: [
              {
                index: 0,
                id: "tool_1",
                type: "function",
                function: { name: "web_search", arguments: '{"query":"example"}' },
              },
            ],
          }
        : { content: "Based on the attached document." };
    const chunk = {
      id: "completion_1",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek-flash",
      choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user: FileUserMessage = {
    role: "user",
    content: "",
    providerFileIds: ["file-api-report"],
    timestamp: Date.now(),
  };
  const agent = createMiniBotAgent({
    apiKey: "mock",
    modelId: "deepseek-flash",
    thinkingLevel: "off",
    history: [{ role: "user", content: "An earlier turn", timestamp: 1 }, user],
    getSandbox: () => Promise.reject(new Error("No sandbox expected")),
  });
  await agent.continue();
  expect(requests).toHaveLength(2);
  for (const payload of requests) {
    expect(payload).toMatchObject({ model: "deepseek-flash", stream: true });
    expect(payload.messages.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "An earlier turn" },
      {
        role: "user",
        content: [{ type: "file", file_id: "file-api-report" }],
      },
    ]);
  }
  expect(requests[1]?.messages.some((message) => message.role === "tool")).toBe(true);
  expect(agent.state.messages.at(-1)).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "Based on the attached document." }],
  });
});
