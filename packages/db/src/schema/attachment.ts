import {
  customType,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { message } from "./chat";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const attachment = pgTable(
  "attachment",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    draftConversationId: uuid(),
    filename: text().notNull(),
    mediaType: text().notNull(),
    kind: text().notNull().default("document"),
    size: integer().notNull(),
    bytes: bytea().notNull(),
    providerFileId: text().notNull(),
    credentialHash: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("attachment_draft_idx").on(t.userId, t.draftConversationId)],
);

export const messageAttachment = pgTable(
  "message_attachment",
  {
    messageId: uuid()
      .notNull()
      .references(() => message.id, { onDelete: "cascade" }),
    attachmentId: uuid()
      .notNull()
      .references(() => attachment.id, { onDelete: "cascade" }),
    position: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.attachmentId] }),
    index("message_attachment_file_idx").on(t.attachmentId),
  ],
);
