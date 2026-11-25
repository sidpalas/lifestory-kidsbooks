CREATE TABLE "family_person" (
	"id" text PRIMARY KEY NOT NULL,
	"family_id" text NOT NULL,
	"name" text NOT NULL,
	"title" text,
	"pronouns" text NOT NULL,
	"age" text NOT NULL,
	"look" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "book_cast" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "family_person" ADD CONSTRAINT "family_person_family_id_organization_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "family_person_family_idx" ON "family_person" USING btree ("family_id");--> statement-breakpoint
ALTER TABLE "book_cast" ADD CONSTRAINT "book_cast_person_id_family_person_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."family_person"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- D61: one person per family for each name, title, pronouns and age in its ordered books (case and spacing ignored;
-- a child's title dropped, as on read), with the newest book's spelling and look; drafts add nobody. Adds rows and
-- links; changes no existing values.
CREATE TEMPORARY TABLE "cast_person_key" AS
SELECT c."book_id", c."slot_id", b."family_id", btrim(c."name") AS "name", c."pronouns", c."age", c."look",
  CASE WHEN c."age" IN ('adult', 'older-adult') THEN c."title" END AS "title",
  coalesce(b."ordered_at", b."created_at") AS "at",
  json_build_array(lower(regexp_replace(btrim(c."name"), '\s+', ' ', 'g')),
    lower(regexp_replace(btrim(CASE WHEN c."age" IN ('adult', 'older-adult') THEN c."title" END), '\s+', ' ', 'g')),
    c."pronouns", c."age")::text AS "key"
FROM "book_cast" c JOIN "book" b ON b."id" = c."book_id"
WHERE b."status" <> 'draft';--> statement-breakpoint
CREATE TEMPORARY TABLE "cast_person_new" AS
SELECT DISTINCT ON ("family_id", "key") 'person_' || gen_random_uuid()::text AS "id", *
FROM "cast_person_key" ORDER BY "family_id", "key", "at" DESC;--> statement-breakpoint
INSERT INTO "family_person" ("id", "family_id", "name", "title", "pronouns", "age", "look")
SELECT "id", "family_id", "name", "title", "pronouns", "age", "look" FROM "cast_person_new";--> statement-breakpoint
UPDATE "book_cast" c SET "person_id" = n."id"
FROM "cast_person_key" k JOIN "cast_person_new" n ON n."family_id" = k."family_id" AND n."key" = k."key"
WHERE c."book_id" = k."book_id" AND c."slot_id" = k."slot_id";
--> statement-breakpoint
DROP TABLE "cast_person_key", "cast_person_new";
