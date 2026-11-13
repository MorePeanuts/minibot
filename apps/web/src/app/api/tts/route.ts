import { z } from "zod";
import { auth } from "@/server/auth";
import { getAssistantReplyText } from "@/server/services/conversations";
import { getAgentSettings } from "@/server/services/settings";

export const maxDuration = 180;

const ids = z.object({ conversationId: z.uuid(), messageId: z.uuid() });
const maxAudioBytes = 64 * 1024 * 1024;
const noStore = { "Cache-Control": "private, no-store" };
const han = /\p{Script=Han}/u;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: noStore });
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return error("Sign in to read a reply aloud.", 401);
  // Require a non-simple request before using the billable API.
  if (request.headers.get("content-type") !== "application/json") {
    return error("Expected a JSON request.", 415);
  }
  const params = new URL(request.url).searchParams;
  const parsed = ids.safeParse({
    conversationId: params.get("conversationId"),
    messageId: params.get("messageId"),
  });
  if (!parsed.success) return error("Invalid reply.", 400);

  const { conversationId, messageId } = parsed.data;
  const text = await getAssistantReplyText(session.user.id, conversationId, messageId);
  if (text === null) return error("Reply not found.", 404);
  if (!text) return error("This reply has no text to read aloud.", 422);
  let characters = 0;
  for (const character of text) {
    characters += han.test(character) ? 2 : 1;
    if (characters > 10_000) {
      return error(
        "This reply is too long to read aloud. The limit is 10,000 characters (each Han character counts twice).",
        413,
      );
    }
  }

  const { apiKey } = await getAgentSettings(session.user.id);
  if (!apiKey) return error("Add your DeepSeek API key in Settings first.", 400);

  try {
    const response = await fetch("https://api.deepseek.com/v1/tools/tts", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: "stella", format: "wav", filter_markdown: true }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(150_000)]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const messages: Partial<Record<number, string>> = {
        401: "DeepSeek rejected the API key. Check Settings.",
        402: "DeepSeek account has insufficient balance.",
        429: "DeepSeek is handling too many requests. Try again shortly.",
      };
      return error(
        messages[response.status] ?? "DeepSeek could not generate audio. Try again.",
        502,
      );
    }
    if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "audio/wav") {
      await response.body?.cancel();
      throw new Error("Expected WAV audio");
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxAudioBytes) {
        await reader.cancel();
        return error("The generated audio is too large to play.", 502);
      }
      chunks.push(value);
    }
    const wav = Buffer.concat(chunks, size);
    if (
      size <= 44 ||
      wav.toString("ascii", 0, 4) !== "RIFF" ||
      wav.toString("ascii", 8, 12) !== "WAVE"
    ) {
      throw new Error("Invalid WAV audio");
    }
    // Streaming WAV may use a placeholder size. Check completeness when the size is known.
    const riffSize = wav.readUInt32LE(4);
    if (riffSize !== 0 && riffSize !== 0xffffffff && riffSize + 8 > size) {
      throw new Error("Incomplete WAV audio");
    }
    return new Response(wav, { headers: { ...noStore, "Content-Type": "audio/wav" } });
  } catch {
    return error("Could not generate audio. Try again.", 502);
  }
}
