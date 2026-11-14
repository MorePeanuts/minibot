ALTER TABLE "attachment" ALTER COLUMN "provider_file_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "credential_hash" DROP NOT NULL;