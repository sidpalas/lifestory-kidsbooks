CREATE TYPE "public"."proof_status" AS ENUM('rendering', 'ready');--> statement-breakpoint
CREATE TABLE "proof" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"story_version_id" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" "proof_status" DEFAULT 'rendering' NOT NULL,
	"task_id" text,
	"object_key" text,
	"page_count" integer,
	"bytes" integer,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_family_id_organization_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proof" ADD CONSTRAINT "proof_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_family_idx" ON "proof" USING btree ("family_id","story_version_id");