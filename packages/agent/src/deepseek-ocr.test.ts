import { afterEach, expect, it, vi } from "vitest";
import { recognizeDeepSeekDocument } from "./deepseek-ocr";

afterEach(() => vi.unstubAllGlobals());

it("sends multipart OCR requests and keeps raw page output plus truncation status", async () => {
  const pages = [
    { index: 0, text: "<｜box｜>[[0, 1, 2, 3]]<｜/box｜>Hello", finish_reason: "stop" },
    { index: 1, text: "Partial", finish_reason: "length" },
  ];
  const fetch = vi.fn(async (url: string, request: RequestInit) => {
    expect(url).toBe("https://api.deepseek.com/v1/tools/ocr");
    expect(request.headers).toEqual({ Authorization: "Bearer mock-key" });
    const form = request.body as FormData;
    expect(form.get("purpose")).toBe("rich_layout_recognition");
    const file = form.get("file") as File;
    expect(file.name).toBe("scan.pdf");
    expect(await file.text()).toBe("PDF bytes");
    return new Response(
      "\n\n" +
        JSON.stringify({
          object: "ocr.result",
          purpose: "rich_layout_recognition",
          page_count: 2,
          pages,
        }),
    );
  });
  vi.stubGlobal("fetch", fetch);
  expect(
    await recognizeDeepSeekDocument(
      "mock-key",
      new File(["PDF bytes"], "scan.pdf"),
      "rich_layout_recognition",
    ),
  ).toEqual(pages);
});

it("detects provider errors after the HTTP 200 keepalive", async () => {
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response('\n{"error":{"message":"OCR did not finish in time"}}', { status: 200 }),
  );
  await expect(
    recognizeDeepSeekDocument("mock-key", new File(["PDF bytes"], "scan.pdf"), "text_recognition"),
  ).rejects.toThrow("OCR did not finish in time");
});
