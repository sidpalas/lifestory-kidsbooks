CREATE TABLE "photo_upload" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"book_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "photo_upload" ADD CONSTRAINT "photo_upload_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "photo_upload_user_idx" ON "photo_upload" USING btree ("user_id","created_at");