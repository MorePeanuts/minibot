import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { voiceMaxFrames, encodeVoiceWav } from "@/lib/chat/voice";
import { auth } from "@/server/auth";
import { POST } from "./route";

vi.mock("@/server/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "test-user" } })) } },
}));
vi.mock("@/server/services/settings", () => ({
  getAgentSettings: async () => ({ apiKey: "sk-test-asr" }),
}));

const fetchUpstream = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchUpstream.mockReset();
  vi.stubGlobal("fetch", fetchUpstream);
});
afterEach(() => vi.unstubAllGlobals());

function recordingRequest(body = encodeVoiceWav(new Int16Array([0, 1024]))) {
  return new Request("http://localhost/api/asr", {
    method: "POST",
    headers: { "Content-Type": "audio/wav" },
    body,
  });
}

it("requires authentication before forwarding audio", async () => {
  vi.mocked(auth.api.getSession).mockResolvedValueOnce(null);
  expect((await POST(recordingRequest())).status).toBe(401);
  expect(fetchUpstream).not.toHaveBeenCalled();
});

it("rejects disguised audio, invalid headers and recordings beyond 120 seconds", async () => {
  const wrongFormat = encodeVoiceWav(new Int16Array([0, 1024]));
  new DataView(wrongFormat).setUint16(34, 8, true);
  expect((await POST(recordingRequest(wrongFormat))).status).toBe(400);
  expect((await POST(recordingRequest(new TextEncoder().encode("not a WAV").buffer))).status).toBe(
    400,
  );
  expect(
    (await POST(recordingRequest(encodeVoiceWav(new Int16Array(voiceMaxFrames + 1))))).status,
  ).toBe(413);
  expect(fetchUpstream).not.toHaveBeenCalled();
});

it("forwards the exact WAV as a multipart file using the server key", async () => {
  fetchUpstream.mockResolvedValue(
    Response.json({ text: "Hello", duration_ms: 10, request_id: "test" }),
  );
  const wav = encodeVoiceWav(new Int16Array([0, 1024]));
  const response = await POST(recordingRequest(wav));
  expect(await response.json()).toEqual({ text: "Hello" });
  expect(fetchUpstream).toHaveBeenCalledTimes(1);
  const [url, options] = fetchUpstream.mock.calls[0]!;
  expect(url).toBe("https://api.deepseek.com/v1/tools/asr");
  expect(options?.method).toBe("POST");
  expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer sk-test-asr");
  const file = (options?.body as FormData).get("file") as File;
  expect(file.name).toBe("recording.wav");
  expect(file.type).toBe("audio/wav");
  expect(await file.arrayBuffer()).toEqual(wav);
});
