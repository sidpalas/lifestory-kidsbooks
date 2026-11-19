ALTER TABLE "proof" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proof" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;