CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"beat_at" timestamp with time zone DEFAULT now() NOT NULL
);
