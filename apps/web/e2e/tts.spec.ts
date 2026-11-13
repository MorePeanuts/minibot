import { expect, test } from "@playwright/test";
import { encodeVoiceWav, voiceSampleRate } from "../src/lib/chat/voice";

test("plays and stops synthesized audio, switches replies and reports generation failure", async ({
  page,
}) => {
  const samples = new Int16Array(voiceSampleRate * 10);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.round(Math.sin((i * 440 * 2 * Math.PI) / voiceSampleRate) * 200);
  }
  const wav = Buffer.from(encodeVoiceWav(samples));
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  let replies = 0;
  let requests = 0;
  let finishCanceledRequest: () => void;
  const canceledRequestGate = new Promise<void>((resolve) => {
    finishCanceledRequest = resolve;
  });

  await page.addInitScript(() => {
    const createAudio = window.Audio;
    const audio: HTMLAudioElement[] = [];
    const revoked: string[] = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revoke(url);
    };
    window.Audio = class extends createAudio {
      constructor(src?: string) {
        super(src);
        audio.push(this);
      }
    };
    Object.assign(window, { testSpeechAudio: audio, testRevoked: revoked });
  });

  await page.route("**/c/*", async (route) => {
    if (route.request().headers().rsc !== "1") await route.continue();
  });
  await page.route("**/api/chat*", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 204 });
      return;
    }
    const messageId = ids[replies++];
    const chunks = [
      { type: "start", messageId },
      { type: "text-start", id: "text" },
      { type: "text-delta", id: "text", delta: "Readable reply" },
      { type: "text-end", id: "text" },
      { type: "finish" },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body:
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    });
  });
  await page.route("**/api/tts?*", async (route) => {
    const request = ++requests;
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("messageId")).toBe(request === 3 ? ids[1] : ids[0]);
    if (request === 1) await canceledRequestGate;
    if (request === 4) {
      await route.fulfill({ status: 502, json: { error: "Mock speech failed" } });
    } else {
      await route.fulfill({ contentType: "audio/wav", body: wav }).catch((error) => {
        if (request === 1) return;
        throw error;
      });
    }
  });

  await page.goto("/register");
  await page.getByLabel("Name").fill("TTS E2E");
  await page.getByLabel("Email").fill(`tts-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("How can I help you today?")).toBeVisible();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (await settings.isVisible()) {
    await settings.getByLabel("DeepSeek API key").fill("sk-tts-e2e-mock-key");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("API key saved")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  const composer = page.getByPlaceholder("Ask MiniBot anything…");
  const assistants = page.locator("[data-role='assistant']");
  for (const message of ["First question", "Second question"]) {
    await composer.fill(message);
    await composer.press("Enter");
    await expect(assistants.last().getByRole("button", { name: "Read aloud" })).toBeVisible();
  }
  await expect(assistants).toHaveCount(2);
  expect(requests).toBe(0);
  const first = assistants.first();
  const second = assistants.last();
  const audioState = () =>
    page.evaluate(() => {
      const state = window as unknown as {
        testSpeechAudio: HTMLAudioElement[];
        testRevoked: string[];
      };
      return {
        playing: state.testSpeechAudio.map((audio) => !audio.paused),
        revoked: state.testRevoked.length,
      };
    });

  await first.getByRole("button", { name: "Read aloud" }).click();
  await expect.poll(() => requests).toBe(1);
  await first.getByRole("button", { name: "Cancel audio generation" }).click();
  finishCanceledRequest!();
  expect(await audioState()).toEqual({ playing: [], revoked: 0 });

  await first.getByRole("button", { name: "Read aloud" }).click();
  await expect(first.getByRole("button", { name: "Stop reading aloud" })).toBeVisible();
  expect(await audioState()).toEqual({ playing: [true], revoked: 0 });

  await second.getByRole("button", { name: "Read aloud" }).click();
  await expect(second.getByRole("button", { name: "Stop reading aloud" })).toBeVisible();
  expect(await audioState()).toEqual({ playing: [false, true], revoked: 1 });

  await second.getByRole("button", { name: "Stop reading aloud" }).click();
  expect(await audioState()).toEqual({ playing: [false, false], revoked: 2 });

  await first.getByRole("button", { name: "Read aloud" }).click();
  await expect(page.getByText("Mock speech failed")).toBeVisible();
  await expect(first.getByRole("button", { name: "Read aloud" })).toBeVisible();
});
