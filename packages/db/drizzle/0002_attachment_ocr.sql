CREATE TABLE "attachment_ocr" (
	"attachment_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"pages" jsonb NOT NULL,
	CONSTRAINT "attachment_ocr_attachment_id_purpose_pk" PRIMARY KEY("attachment_id","purpose")
);
--> statement-breakpoint
ALTER TABLE "attachment_ocr" ADD CONSTRAINT "attachment_ocr_attachment_id_attachment_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachment"("id") ON DELETE cascade ON UPDATE no action;