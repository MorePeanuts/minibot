export type OcrPurpose = "text_recognition" | "rich_layout_recognition";

export interface OcrPage {
  index: number;
  text: string;
  finish_reason: "stop" | "length";
}

export async function recognizeDeepSeekDocument(apiKey: string, file: File, purpose: OcrPurpose) {
  const body = new FormData();
  body.append("file", file);
  body.append("purpose", purpose);
  const timeout = AbortSignal.timeout(180_000);
  try {
    const response = await fetch("https://api.deepseek.com/v1/tools/ocr", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: timeout,
    });
    const result = (await response.json().catch((error: unknown) => {
      if (timeout.aborted) throw error;
      throw new Error(`DeepSeek OCR returned an unreadable response (HTTP ${response.status}).`, {
        cause: error,
      });
    })) as {
      error?: { message?: unknown };
      object?: unknown;
      purpose?: unknown;
      page_count?: unknown;
      pages?: unknown;
    } | null;
    if (result?.error || !response.ok) {
      const message = result?.error?.message;
      throw new Error(
        typeof message === "string"
          ? `DeepSeek OCR: ${message.slice(0, 500)}`
          : `DeepSeek OCR returned HTTP ${response.status}.`,
      );
    }
    if (
      result?.object !== "ocr.result" ||
      result.purpose !== purpose ||
      !Array.isArray(result.pages) ||
      !result.pages.length ||
      result.pages.length > 1_000 ||
      result.page_count !== result.pages.length ||
      !result.pages.every(
        (page: OcrPage, index: number) =>
          page?.index === index &&
          typeof page.text === "string" &&
          (page.finish_reason === "stop" || page.finish_reason === "length"),
      )
    ) {
      throw new Error("DeepSeek OCR returned invalid page data.");
    }
    return (result.pages as OcrPage[]).map(({ index, text, finish_reason }) => ({
      index,
      text,
      finish_reason,
    }));
  } catch (error) {
    if (timeout.aborted)
      throw new Error("DeepSeek OCR exceeded its 180-second timeout.", { cause: error });
    throw error;
  }
}
