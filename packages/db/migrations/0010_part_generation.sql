CREATE TYPE "public"."part_status" AS ENUM('generating', 'pending_review', 'approved', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "story_part" (
	"id" text PRIMARY KEY NOT NULL,
	"story_version_id" text NOT NULL,
	"page_id" text NOT NULL,
	"slot_id" text NOT NULL,
	"age" text NOT NULL,
	"face" text NOT NULL,
	"axis" text NOT NULL,
	"option" text NOT NULL,
	"seed" integer NOT NULL,
	"zone" jsonb NOT NULL,
	"note" text,
	"prompt" text NOT NULL,
	"status" "part_status" DEFAULT 'generating' NOT NULL,
	"task_id" text,
	"generation_id" text,
	"layers" jsonb,
	"previews" jsonb,
	"metrics" jsonb,
	"error" text,
	"requested_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "usage" jsonb;--> statement-breakpoint
ALTER TABLE "generation" ADD COLUMN "cost_usd" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "story_part" ADD CONSTRAINT "story_part_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_part" ADD CONSTRAINT "story_part_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_part" ADD CONSTRAINT "story_part_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_part" ADD CONSTRAINT "story_part_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "story_part_story_version_idx" ON "story_part" USING btree ("story_version_id");