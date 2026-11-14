import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth";

/** Per-user preferences. The API key is stored encrypted (AES-256-GCM), never in plain text. */
export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  chatProvider: text("chat_provider", { enum: ["deepseek", "responses"] })
    .notNull()
    .default("deepseek"),
  responsesBaseUrl: text("responses_base_url"),
  responsesModel: text("responses_model"),
  encryptedResponsesApiKey: text("encrypted_responses_api_key"),
  responsesReasoning: boolean("responses_reasoning").notNull().default(false),
  encryptedApiKey: text("encrypted_api_key"),
  model: text("model").notNull().default("deepseek-flash"),
  thinkingLevel: text("thinking_level").notNull().default("low"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});
