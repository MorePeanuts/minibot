import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 320, height: 700 },
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("dictates to the editable draft and releases the microphone when stopped or canceled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    Object.assign(window, { testMicrophones: [] });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      (window as unknown as { testMicrophones: MediaStreamTrack[] }).testMicrophones.push(
        ...stream.getTracks(),
      );
      return stream;
    };
  });

  let requests = 0;
  let sends = 0;
  let releaseTranscript: () => void;
  const transcriptGate = new Promise<void>((resolve) => {
    releaseTranscript = resolve;
  });
  await page.route("**/api/chat*", async (route) => {
    if (route.request().method() === "POST") sends++;
    await route.fulfill({ status: 404 });
  });
  await page.route("**/api/asr", async (route) => {
    requests++;
    const bytes = route.request().postDataBuffer()!;
    expect(route.request().headers()["content-type"]).toBe("audio/wav");
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    expect(bytes.readUInt16LE(34)).toBe(16);
    expect(bytes.readUInt32LE(24)).toBe(16_000);
    expect(bytes.byteLength).toBeGreaterThan(44);
    expect(bytes.readUInt32LE(40)).toBe(bytes.byteLength - 44);
    if (requests === 1) {
      await transcriptGate;
      await route.fulfill({ json: { text: "Spoken words" } });
    } else {
      await route.fulfill({ status: 502, json: { error: "Mock transcription failed" } });
    }
  });

  await page.goto("/register");
  await page.getByLabel("Name").fill("Voice E2E");
  await page.getByLabel("Email").fill(`voice-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("How can I help you today?")).toBeVisible();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (await settings.isVisible()) {
    await settings.getByLabel("DeepSeek API key").fill("sk-voice-e2e-mock-key");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("API key saved")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  const draft = page.getByPlaceholder("Ask MiniBot anything…");
  const record = page.getByRole("button", { name: "Record voice" });
  const stop = page.getByRole("button", { name: "Stop recording and transcribe" });
  const trackStates = () =>
    page.evaluate(() =>
      (window as unknown as { testMicrophones: MediaStreamTrack[] }).testMicrophones.map(
        (track) => track.readyState,
      ),
    );
  await draft.fill("Original draft");
  await record.click();
  await expect(page.getByText("Recording… Up to 120 seconds.")).toBeVisible();
  await expect.poll(trackStates).toEqual(["live"]);
  await page.getByRole("button", { name: "Cancel recording" }).click();
  await expect.poll(trackStates).toEqual(["ended"]);
  expect(requests).toBe(0);

  await record.click();
  await expect(stop).toBeVisible();
  await draft.fill("Edited during recording");
  await stop.click();
  await expect(page.getByText("Transcribing…")).toBeVisible();
  await expect.poll(trackStates).toEqual(["ended", "ended"]);
  await draft.fill("Edited during transcription");
  releaseTranscript!();
  await expect(draft).toHaveValue("Edited during transcription\nSpoken words");

  await record.click();
  await expect(stop).toBeVisible();
  await draft.fill("Keep this draft");
  await stop.click();
  await expect(page.getByText("Mock transcription failed")).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft");
  await expect.poll(trackStates).toEqual(["ended", "ended", "ended"]);
  expect(requests).toBe(2);
  expect(sends).toBe(0);

  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied", "NotAllowedError");
    };
  });
  await record.click();
  await expect(page.getByText("Microphone permission was denied.", { exact: false })).toBeVisible();
  await expect(draft).toHaveValue("Keep this draft");
});
