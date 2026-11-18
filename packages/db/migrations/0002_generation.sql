CREATE TYPE "public"."generation_status" AS ENUM('submitted', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "generation" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"request" jsonb NOT NULL,
	"status" "generation_status" DEFAULT 'submitted' NOT NULL,
	"event_name" text NOT NULL,
	"object_key" text NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
