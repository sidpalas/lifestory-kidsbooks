CREATE TABLE "story_version" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"version" integer NOT NULL,
	"manifest" jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_version_story_version_key" UNIQUE("story_id","version"),
	CONSTRAINT "story_version_version_positive" CHECK ("story_version"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "story_version" ADD CONSTRAINT "story_version_story_id_story_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."story"("id") ON DELETE restrict ON UPDATE no action;