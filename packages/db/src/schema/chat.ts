import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    /** Archived conversations are hidden from the main sidebar list but kept intact. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    /** Lineage for conversations created via "fork from here". */
    forkedFromId: uuid("forked_from_id").references((): AnyPgColumn => conversation.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (t) => [index("conversation_user_updated_idx").on(t.userId, t.updatedAt)],
);

/**
 * One row per pi-agent message (user / assistant / toolResult).
 * The full message is stored verbatim as JSONB so the agent context can be rebuilt
 * losslessly (thinking blocks, tool calls, usage, stop reasons ...).
 */
export const message = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    /** Monotonic position inside a conversation; defines ordering and fork points. */
    seq: integer("seq").notNull(),
    role: text("role").$type<AgentMessage["role"]>().notNull(),
    data: jsonb("data").$type<AgentMessage>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("message_conversation_seq_idx").on(t.conversationId, t.seq)],
);

export const conversationRelations = relations(conversation, ({ many }) => ({
  messages: many(message),
}));

export const messageRelations = relations(message, ({ one }) => ({
  conversation: one(conversation, {
    fields: [message.conversationId],
    references: [conversation.id],
  }),
}));
