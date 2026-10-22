import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running MiniBot (default: `pnpm dev` on :3000).
 * Chat tests need a DeepSeek key (DEEPSEEK_API_KEY on the server) and are skipped otherwise.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 120_000 },
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
