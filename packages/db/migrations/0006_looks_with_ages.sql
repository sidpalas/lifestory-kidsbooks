-- Looks gain an age and their faces become face types (D29): the four age-bound faces of book format 1 map to the
-- same drawings as book format 2's upgrade of stored manifests (packages/core book-format/manifest.ts, upgradeFormat1),
-- so characters, book overrides and stored proofs keep drawing exactly what they drew. Running it twice changes nothing:
-- only the old face IDs match.
UPDATE "character"
SET "look" = "look" || ('{"face:child-1": {"age": "young-child", "face": "face:round"},
                         "face:child-2": {"age": "young-child", "face": "face:oval"},
                         "face:adult-1": {"age": "adult", "face": "face:oval"},
                         "face:adult-2": {"age": "adult", "face": "face:round"}}'::jsonb -> ("look" ->> 'face'))
WHERE "look" ->> 'face' IN ('face:child-1', 'face:child-2', 'face:adult-1', 'face:adult-2');
--> statement-breakpoint
-- An override never sets an age (a role's ages say who may play it), so only its face type changes.
UPDATE "book_cast"
SET "look_override" = "look_override" || jsonb_build_object('face', ('{"face:child-1": "face:round", "face:child-2": "face:oval",
                                                                       "face:adult-1": "face:oval", "face:adult-2": "face:round"}'::jsonb
                                                                      ->> ("look_override" ->> 'face')))
WHERE "look_override" ->> 'face' IN ('face:child-1', 'face:child-2', 'face:adult-1', 'face:adult-2');
--> statement-breakpoint
-- A proof records its cast (D27): each member's look, by slot.
UPDATE "proof"
SET "content" = jsonb_set("content", '{cast}', (
  SELECT jsonb_object_agg(
    member.key,
    CASE
      WHEN member.value -> 'look' ->> 'face' IN ('face:child-1', 'face:child-2', 'face:adult-1', 'face:adult-2')
      THEN jsonb_set(member.value, '{look}', (member.value -> 'look') || ('{"face:child-1": {"age": "young-child", "face": "face:round"},
                                                                            "face:child-2": {"age": "young-child", "face": "face:oval"},
                                                                            "face:adult-1": {"age": "adult", "face": "face:oval"},
                                                                            "face:adult-2": {"age": "adult", "face": "face:round"}}'::jsonb
                                                                           -> (member.value -> 'look' ->> 'face')))
      ELSE member.value
    END)
  FROM jsonb_each("content" -> 'cast') AS member))
WHERE jsonb_typeof("content" -> 'cast') = 'object' AND "content" -> 'cast' <> '{}'::jsonb;
