// A family's members as characters (D26): a name, pronouns, and a look from the shared vocabulary, owned by the
// family. Anyone in the family reads them; owners and parents edit them (a viewer can't).
import { schema } from "@lifestory/db";
import { asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { Character, type CharacterInput } from "./contracts.ts";
import { Database } from "./database.ts";
import { NotFound } from "./errors.ts";
import { requireFamilyAccess } from "./families.ts";

const decodeCharacter = Schema.decodeUnknownEffect(Character);

const columns = {
  id: schema.character.id,
  familyId: schema.character.familyId,
  name: schema.character.name,
  pronouns: schema.character.pronouns,
  look: schema.character.look,
};

/** Rows are written only through saveCharacter, which validates them, so a decode failure is a bug. */
const decodeRows = (rows: ReadonlyArray<unknown>) => Effect.forEach(rows, (row) => decodeCharacter(row).pipe(Effect.orDie));

/** The family's characters by name, for any member. */
export const listCharacters = Effect.fn("characters.list")(function* (userId: string, familyId: string) {
  const access = yield* requireFamilyAccess(userId, familyId, "read");
  const rows = yield* Database.query((db) =>
    db.select(columns).from(schema.character).where(eq(schema.character.familyId, familyId)).orderBy(asc(schema.character.name)),
  );
  return { characters: yield* decodeRows(rows), canEdit: access.canEdit };
});

const findCharacter = Effect.fn("characters.find")(function* (characterId: string) {
  const [row] = yield* Database.query((db) => db.select(columns).from(schema.character).where(eq(schema.character.id, characterId)));
  if (!row) return yield* new NotFound({ entity: "character", id: characterId });
  return yield* decodeCharacter(row).pipe(Effect.orDie);
});

/** One character, for any member of its family. */
export const getCharacter = Effect.fn("characters.get")(function* (userId: string, characterId: string) {
  const character = yield* findCharacter(characterId);
  const access = yield* requireFamilyAccess(userId, character.familyId, "read");
  return { character, canEdit: access.canEdit };
});

/** Adds a character to a family. */
export const createCharacter = Effect.fn("characters.create")(function* (userId: string, familyId: string, input: CharacterInput) {
  yield* requireFamilyAccess(userId, familyId, "edit");
  const id = `char_${crypto.randomUUID()}`;
  yield* Database.query((db) => db.insert(schema.character).values({ id, familyId, ...input }));
  return { id };
});

/** Changes a character. Every book that casts them redraws from the new look the next time it's shown (plan.md). */
export const updateCharacter = Effect.fn("characters.update")(function* (userId: string, characterId: string, input: CharacterInput) {
  const character = yield* findCharacter(characterId);
  yield* requireFamilyAccess(userId, character.familyId, "edit");
  yield* Database.query((db) => db.update(schema.character).set(input).where(eq(schema.character.id, characterId)));
  return { id: characterId };
});
