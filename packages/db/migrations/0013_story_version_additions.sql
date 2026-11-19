CREATE TABLE "story_version_addition" (
	"story_version_id" text NOT NULL,
	"revision" integer NOT NULL,
	"addition" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "story_version_addition_story_version_id_revision_pk" PRIMARY KEY("story_version_id","revision"),
	CONSTRAINT "story_version_addition_revision_positive" CHECK ("story_version_addition"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "proof" ADD COLUMN "addition_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story_version_addition" ADD CONSTRAINT "story_version_addition_story_version_id_story_version_id_fk" FOREIGN KEY ("story_version_id") REFERENCES "public"."story_version"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_version_addition" ADD CONSTRAINT "story_version_addition_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;