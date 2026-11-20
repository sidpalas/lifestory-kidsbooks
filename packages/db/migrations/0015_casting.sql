ALTER TABLE "story_version" ADD COLUMN "casting" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "story_part" ADD COLUMN "review_reason" text;