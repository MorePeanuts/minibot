import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, test } from "@playwright/test";

test("saves and uses a custom Responses provider", async ({ page }, testInfo) => {
  const requests: { path?: string; authorization?: string; body: Record<string, unknown> }[] = [];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw);
    requests.push({ path: request.url, authorization: request.headers.authorization, body });
    const isTitle = raw.includes("You name chat conversations");
    const id = isTitle ? "title" : "chat";
    const text = isTitle ? "Relay check" : "Hello from the relay.";
    const item = {
      type: "message",
      id: `msg_${id}`,
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text, annotations: [] }],
    };
    const events = [
      { type: "response.created", response: { id: `resp_${id}` } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      { type: "response.output_text.delta", output_index: 0, delta: text },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: { id: `resp_${id}`, status: "completed", output: [item] },
      },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  });
  await new Promise<void>((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected a relay port");
    const baseUrl = `http://127.0.0.1:${address.port}/gateway/v1`;
    const model = "relay/model-test";
    const apiKey = "mock-relay-123456789";

    await page.goto("/register");
    await page.getByLabel("Name").fill("Relay E2E User");
    await page.getByLabel("Email").fill(`e2e-${randomUUID()}@minibot.dev`);
    await page.getByLabel("Password").fill("password123");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText("How can I help you today?")).toBeVisible();

    const settings = page.getByRole("dialog", { name: "Settings" });
    if (!(await settings.isVisible())) {
      await page.getByRole("button", { name: /Relay E2E User/ }).click();
      await page.getByRole("menuitem", { name: "Settings" }).click();
    }
    await settings.getByLabel("Chat provider").click();
    await page.getByRole("option", { name: "Custom Responses API" }).click();
    await settings.getByLabel("Base URL").fill(`${baseUrl}/responses/`);
    await settings.getByLabel("Model ID").fill(model);
    await settings.getByLabel("Responses API key").fill(apiKey);
    await settings.getByRole("button", { name: "Save Responses settings" }).click();
    await expect(settings.getByText("mock-…6789")).toBeVisible();
    await testInfo.attach("Responses settings", {
      body: await settings.screenshot(),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");

    const composer = page.getByPlaceholder("Ask MiniBot anything…");
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=",
      "base64",
    );
    const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF");
    await page.locator('input[type="file"]').setInputFiles([
      { name: "relay-image.png", mimeType: "image/png", buffer: png },
      { name: "relay-document.pdf", mimeType: "application/octet-stream", buffer: pdf },
    ]);
    await expect(page.getByRole("button", { name: "Remove relay-image.png" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Remove relay-document.pdf" })).toBeEnabled();
    await composer.fill("Say hello");
    await composer.press("Enter");
    await expect(page.locator("[data-role='assistant']")).toContainText("Hello from the relay.");
    await expect(page.getByRole("heading", { name: "Relay check" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Relay check" })).toBeVisible();
    await expect(page.getByText(model, { exact: true })).toBeVisible();
    await expect(page.locator("[data-role='assistant']")).toContainText("Hello from the relay.");

    await expect(page.getByRole("link", { name: "relay-document.pdf" })).toBeVisible();
    await composer.fill("Describe the same files again");
    await composer.press("Enter");
    await expect(page.locator("[data-role='assistant']")).toHaveCount(2);
    await expect(page.locator("[data-role='assistant']").last()).toContainText(
      "Hello from the relay.",
    );

    expect(requests).toHaveLength(3);
    const turns = requests.filter(
      ({ body }) => !JSON.stringify(body.input).includes("You name chat conversations"),
    );
    expect(turns).toHaveLength(2);
    for (const { body } of turns) {
      expect(JSON.stringify(body.input)).not.toContain('"file_id"');
      expect(body.input).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              {
                type: "input_image",
                image_url: `data:image/png;base64,${png.toString("base64")}`,
                detail: "auto",
              },
              {
                type: "input_file",
                filename: "relay-document.pdf",
                file_data: `data:application/pdf;base64,${pdf.toString("base64")}`,
              },
            ]),
          }),
        ]),
      );
    }
    for (const request of requests) {
      expect(request).toMatchObject({
        path: "/gateway/v1/responses",
        authorization: `Bearer ${apiKey}`,
        body: { model, stream: true },
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
