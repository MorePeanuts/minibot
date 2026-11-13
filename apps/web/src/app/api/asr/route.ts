import { isVoiceWav, voiceMaxBytes } from "@/lib/chat/voice";
import { auth } from "@/server/auth";
import { getAgentSettings } from "@/server/services/settings";

export const maxDuration = 180;

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to transcribe audio." }, { status: 401 });

  const sizeError = () =>
    Response.json({ error: "Recordings must be 120 seconds or shorter." }, { status: 413 });
  if (Number(request.headers.get("content-length")) > voiceMaxBytes) return sizeError();
  // Require a same-origin, non-simple browser request before using a billable API.
  if (request.headers.get("content-type") !== "audio/wav") {
    return Response.json({ error: "Expected a WAV recording." }, { status: 415 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "No audio was recorded." }, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > voiceMaxBytes) {
        await reader.cancel();
        return sizeError();
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: "Audio upload was interrupted." }, { status: 400 });
  }

  const bytes = Buffer.concat(chunks, size);
  if (!isVoiceWav(bytes)) {
    return Response.json({ error: "Invalid 16-bit mono PCM WAV recording." }, { status: 400 });
  }
  const { apiKey } = await getAgentSettings(session.user.id);
  if (!apiKey) {
    return Response.json(
      { error: "Add your DeepSeek API key in Settings first." },
      { status: 400 },
    );
  }

  const body = new FormData();
  body.append("file", new Blob([bytes], { type: "audio/wav" }), "recording.wav");
  try {
    const response = await fetch("https://api.deepseek.com/v1/tools/asr", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok) {
      const messages: Partial<Record<number, string>> = {
        401: "DeepSeek rejected the API key. Check Settings.",
        402: "DeepSeek account has insufficient balance.",
        429: "DeepSeek is handling too many requests. Try again shortly.",
      };
      return Response.json(
        {
          error: messages[response.status] ?? "DeepSeek could not transcribe the audio. Try again.",
        },
        { status: 502 },
      );
    }
    const result = (await response.json()) as { text?: unknown } | null;
    if (typeof result?.text !== "string") throw new Error("Invalid transcription response");
    return Response.json({ text: result.text });
  } catch {
    return Response.json({ error: "Could not transcribe the audio. Try again." }, { status: 502 });
  }
}
