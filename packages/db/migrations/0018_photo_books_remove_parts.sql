-- Photo books replace looks and parts (D56). Every story version of book format 1–3 is a parts story, which Sid
-- had wiped (2026-11-24): their books (with cast, text edits and proofs) and the versions go, then any story left
-- without a version. The storage.sweep task deletes their objects: proofs whose row is gone, and stories/<id>/
-- folders whose story is gone.
DELETE FROM "proof" WHERE "story_version_id" IN (SELECT "id" FROM "story_version" WHERE ("manifest"->>'formatVersion')::int < 4);--> statement-breakpoint
DELETE FROM "book" WHERE "story_version_id" IN (SELECT "id" FROM "story_version" WHERE ("manifest"->>'formatVersion')::int < 4);--> statement-breakpoint
DROP TABLE "story_version_addition" CASCADE;--> statement-breakpoint
DROP TABLE "story_part" CASCADE;--> statement-breakpoint
DELETE FROM "story_version" WHERE ("manifest"->>'formatVersion')::int < 4;--> statement-breakpoint
DELETE FROM "story" WHERE NOT EXISTS (SELECT 1 FROM "story_version" WHERE "story_version"."story_id" = "story"."id");--> statement-breakpoint
ALTER TABLE "character" ADD COLUMN "age" text;--> statement-breakpoint
UPDATE "character" SET "age" = COALESCE("look"->>'age', 'adult');--> statement-breakpoint
ALTER TABLE "character" ALTER COLUMN "age" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "story_version" DROP COLUMN "casting";--> statement-breakpoint
ALTER TABLE "proof" DROP COLUMN "addition_revision";--> statement-breakpoint
ALTER TABLE "book_cast" DROP COLUMN "look_override";--> statement-breakpoint
ALTER TABLE "book_cast" DROP COLUMN "look_changes";--> statement-breakpoint
ALTER TABLE "character" DROP COLUMN "look";--> statement-breakpoint
DROP TYPE "public"."part_status";
