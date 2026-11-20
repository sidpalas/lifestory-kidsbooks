-- Babies gain a hairstyle (D51): before, a baby was drawn bald whatever hairstyle its look held ("hair:short" from the
-- curated babies), and the full-head styles aren't offered at baby any more. Every baby look becomes "hair:none",
-- which is what it drew, so characters, books and stored proofs keep drawing the same. Running it twice changes nothing.
UPDATE "character"
SET "look" = jsonb_set("look", '{hair}', '"hair:none"')
WHERE "look" ->> 'age' = 'baby' AND "look" ->> 'hair' IS DISTINCT FROM 'hair:none';
--> statement-breakpoint
-- A book's own hair change or stand-in for a baby (D46, D28) drew bald too. Age comes from the character: changes never set one.
UPDATE "book_cast"
SET "look_changes" = jsonb_set("look_changes", '{hair}', '"hair:none"')
WHERE "look_changes" ? 'hair' AND "look_changes" ->> 'hair' <> 'hair:none'
  AND "character_id" IN (SELECT "id" FROM "character" WHERE "look" ->> 'age' = 'baby');
--> statement-breakpoint
UPDATE "book_cast"
SET "look_override" = jsonb_set("look_override", '{hair}', '"hair:none"')
WHERE "look_override" ? 'hair' AND "look_override" ->> 'hair' <> 'hair:none'
  AND "character_id" IN (SELECT "id" FROM "character" WHERE "look" ->> 'age' = 'baby');
--> statement-breakpoint
-- A proof records its cast (D27): each member's look, by slot.
UPDATE "proof"
SET "content" = jsonb_set("content", '{cast}', (
  SELECT jsonb_object_agg(
    member.key,
    CASE
      WHEN member.value -> 'look' ->> 'age' = 'baby' AND member.value -> 'look' ->> 'hair' IS DISTINCT FROM 'hair:none'
      THEN jsonb_set(member.value, '{look,hair}', '"hair:none"')
      ELSE member.value
    END)
  FROM jsonb_each("content" -> 'cast') AS member))
WHERE jsonb_typeof("content" -> 'cast') = 'object' AND "content" -> 'cast' <> '{}'::jsonb
  AND EXISTS (SELECT 1 FROM jsonb_each("content" -> 'cast') AS member
              WHERE member.value -> 'look' ->> 'age' = 'baby' AND member.value -> 'look' ->> 'hair' IS DISTINCT FROM 'hair:none');
