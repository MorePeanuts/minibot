ALTER TABLE "user_settings" ADD COLUMN "chat_provider" text DEFAULT 'deepseek' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "responses_base_url" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "responses_model" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "encrypted_responses_api_key" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "responses_reasoning" boolean DEFAULT false NOT NULL;