ALTER TABLE "book_cast" ADD COLUMN "look" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- The hair chips the parent chose become their choices for the look.
UPDATE "book_cast" c SET "look" = jsonb_build_object(
  'hairColour', l."hair"->>'colour', 'hairLength', l."hair"->>'length', 'hairTexture', l."hair"->>'texture')
FROM "book_likeness" l
WHERE l."book_id" = c."book_id" AND l."slot_id" = c."slot_id" AND l."hair" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "book_likeness" DROP COLUMN "hair";