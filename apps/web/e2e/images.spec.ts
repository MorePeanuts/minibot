import { expect, test } from "@playwright/test";

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=";

test("attaches and pastes screenshots and retains the draft after a failed send", async ({
  page,
}) => {
  const png = Buffer.from(pngBase64, "base64");
  let uploadCount = 0;
  let sends = 0;
  // The mock chat stream never writes conversation rows; keep its client-side result.
  await page.route("**/c/*", async (route) => {
    if (route.request().headers().rsc !== "1") await route.continue();
  });
  await page.route("**/api/attachments?*", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("kind")).toBe("image");
    uploadCount++;
    await route.fulfill({
      status: 201,
      json: {
        id: crypto.randomUUID(),
        filename: uploadCount === 1 ? "picker.png" : "Screenshot.png",
        mediaType: "image/png",
      },
    });
  });
  await page.route("**/api/attachments/*", async (route) => {
    if (route.request().method() === "DELETE") await route.fulfill({ status: 204 });
    else await route.fulfill({ contentType: "image/png", body: png });
  });
  await page.route("**/api/chat*", async (route) => {
    if (route.request().method() === "HEAD") {
      await route.fulfill({ status: sends === 1 ? 404 : 204 });
      return;
    }
    sends++;
    expect(route.request().postDataJSON().message).toMatchObject({
      text: "What does this show?",
      attachmentIds: [expect.any(String)],
    });
    if (sends === 1) {
      await route.fulfill({ status: 400, json: { error: "Mock send failed" } });
      return;
    }
    await route.fulfill({
      contentType: "text/event-stream",
      headers: { "x-vercel-ai-ui-message-stream": "v1" },
      body: 'data: {"type":"start","messageId":"mock-assistant"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
    });
  });

  await page.goto("/register");
  await page.getByLabel("Name").fill("Image E2E");
  await page.getByLabel("Email").fill(`images-${crypto.randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("How can I help you today?")).toBeVisible();
  const settings = page.getByRole("dialog", { name: "Settings" });
  if (await settings.isVisible()) {
    await settings.getByLabel("DeepSeek API key").fill("sk-image-e2e-mock-key");
    await settings.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("API key saved")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  await page.locator('input[type="file"]').setInputFiles({
    name: "picker.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByRole("img", { name: "Preview of picker.png" })).toBeVisible();
  await page.getByRole("button", { name: "Remove picker.png" }).click();
  await expect(page.getByRole("img", { name: "Preview of picker.png" })).toHaveCount(0);

  const composer = page.getByPlaceholder("Ask MiniBot anything…");
  await composer.fill("What does this show?");
  await composer.evaluate((element, base64) => {
    const data = new DataTransfer();
    data.items.add(
      new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], "", {
        type: "image/png",
      }),
    );
    data.setData("text/plain", "mixed clipboard text");
    const event = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData: data,
    });
    if (!element.dispatchEvent(event))
      throw new Error("Mixed paste canceled the browser's text insertion");
  }, pngBase64);
  await expect(page.getByRole("img", { name: "Preview of Screenshot.png" })).toBeVisible();
  await expect(page.getByText(/Images use DeepSeek Flash/)).toBeVisible();

  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Mock send failed")).toBeVisible();
  await expect(composer).toHaveValue("What does this show?");
  await expect(page.getByRole("img", { name: "Preview of Screenshot.png" })).toBeVisible();
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("img", { name: "Preview of Screenshot.png" })).toHaveCount(0);
  const download = page.getByRole("link", { name: "Download Screenshot.png" });
  await expect(download.getByRole("img", { name: "Screenshot.png" })).toBeVisible();
  await expect(download).toHaveAttribute("download", "");
});
