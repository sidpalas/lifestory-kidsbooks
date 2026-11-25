ALTER TABLE "book_likeness" ADD COLUMN "draws" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "book_likeness" ADD COLUMN "drawing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Drawings already used: the first sheet, plus one per note asked for since.
UPDATE "book_likeness" SET "draws" = 1 + jsonb_array_length("notes") WHERE "sheet_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "book" DROP COLUMN "likeness_round";