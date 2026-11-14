import { beforeEach, expect, it, vi } from "vitest";
import { updateSettingsAction } from "./settings";

const { updateSettings } = vi.hoisted(() => ({
  updateSettings: vi.fn(async () => undefined),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/session", () => ({ requireUser: async () => ({ id: "test-user" }) }));
vi.mock("@/server/services/settings", () => ({ updateSettings }));

beforeEach(() => updateSettings.mockClear());

it("normalizes a pasted Responses endpoint and preserves a relay path", async () => {
  const result = await updateSettingsAction({
    chatProvider: "responses",
    responsesBaseUrl: " https://relay.example.test/team/v1/responses/ ",
    responsesModel: " vendor/model ",
    responsesApiKey: "relay-key",
  });
  expect(result).toEqual({ ok: true });
  expect(updateSettings).toHaveBeenCalledWith("test-user", {
    chatProvider: "responses",
    responsesBaseUrl: "https://relay.example.test/team/v1",
    responsesModel: "vendor/model",
    responsesApiKey: "relay-key",
  });
});

it.each([
  "https://user:password@relay.example.test/v1",
  "https://relay.example.test/v1?token=secret",
  "https://relay.example.test/v1#fragment",
  "file:///tmp/relay",
])("rejects an invalid endpoint", async (responsesBaseUrl) => {
  expect(await updateSettingsAction({ responsesBaseUrl })).toMatchObject({ ok: false });
  expect(updateSettings).not.toHaveBeenCalled();
});
