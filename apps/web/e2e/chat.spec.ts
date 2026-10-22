import { expect, type Page, test } from "@playwright/test";

const hasKey = Boolean(process.env.DEEPSEEK_API_KEY);

async function register(page: Page) {
  const email = `e2e-${Date.now()}@minibot.dev`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page.getByText("How can I help you today?")).toBeVisible();
}

test("redirects anonymous users to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Welcome back")).toBeVisible();
});

test("chat, fork, archive", async ({ page }) => {
  test.skip(!hasKey, "DEEPSEEK_API_KEY not set");
  await register(page);
  await page.screenshot({ path: "test-results/01-empty.png" });

  const composer = page.getByPlaceholder("Ask MiniBot anything…");
  await composer.fill("Reply with exactly the word: pong");
  await composer.press("Enter");

  await expect(page).toHaveURL(/\/c\/[0-9a-f-]{36}$/);
  const firstUrl = page.url();
  const assistant = page.locator("[data-role='assistant']").last();
  await expect(assistant).toContainText(/pong/i);
  // Streaming finished: the composer shows "Send" again and the generated title appears.
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("New chat");
  await page.screenshot({ path: "test-results/02-chat.png" });

  // Fork from the assistant reply: the new chat contains both messages.
  await assistant.hover();
  await assistant.getByRole("button", { name: "Fork into new chat" }).click();
  await expect(page).not.toHaveURL(firstUrl);
  await expect(page.getByRole("heading", { name: /\(fork\)/ })).toBeVisible();
  await expect(page.locator("[data-role='user']")).toHaveCount(1);
  await expect(page.locator("[data-role='assistant']")).toContainText(/pong/i);
  await page.screenshot({ path: "test-results/03-fork.png" });

  // Archive the fork from the sidebar menu.
  const item = page.locator("[data-sidebar='menu-item']", { hasText: "(fork)" });
  await item.hover();
  await item.getByRole("button", { name: "Conversation actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByText("Chat archived")).toBeVisible();
  await expect(item).toHaveCount(0);
  await page.screenshot({ path: "test-results/04-archived.png" });
});
