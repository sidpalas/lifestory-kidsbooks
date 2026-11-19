// Starting a family's book of a story: choose which family member plays each role. A role accepts some character
// ages (D29), so only family members of those ages are offered.
import { ageLabel, type Character, type CharacterSlot, optionLabel, type StoryManifest, unsupportedOptions, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

/** "young child or older child". */
export const agesLabel = (slot: CharacterSlot) => slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ");

/**
 * What the story can't draw of `character` in `slotId` yet, as a parent reads it ("red hair"): an option added to
 * the vocabulary after the story was published and not yet added to it (D41). The book asks for a stand-in.
 */
const notDrawable = (manifest: StoryManifest, slotId: string, character: Character) =>
  unsupportedOptions(manifest, slotId, character.look)
    .filter((axis) => axis !== "age")
    .map((axis) => optionLabel(character.look[axis]));

export function MakeBook({ slug, manifest, characters }: { slug: string; manifest: StoryManifest; characters: ReadonlyArray<Character> }) {
  const slots = manifest.characterSlots;
  const router = useRouter();
  const hydrated = useHydrated();
  const fits = (slot: CharacterSlot) => characters.filter((character) => slot.ages.includes(character.look.age));
  const [cast, setCast] = useState<Record<string, string>>(() =>
    Object.fromEntries(slots.flatMap((slot) => (fits(slot)[0] ? [[slot.slotId, fits(slot)[0]!.id]] : []))),
  );
  const [error, setError] = useState<string | null>(null);
  const ready = slots.every((slot) => cast[slot.slotId]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const { id } = unwrapResult(CreateBookResult)(await createBookFn({ data: { slug, cast } }));
      await router.navigate({ to: "/books/$bookId", params: { bookId: id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Make our book</CardTitle>
        <CardDescription>Choose who plays each part. Every page is drawn with their looks.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="flex flex-wrap items-end gap-4" onSubmit={create} aria-label="Make our book">
          {slots.map((slot) => (
            <div key={slot.slotId} className="flex min-w-48 flex-col gap-2">
              <Label htmlFor={`cast-${slot.slotId}`}>
                {slot.label} <span className="text-muted-foreground font-normal">({agesLabel(slot)})</span>
              </Label>
              {fits(slot).length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nobody yet.{" "}
                  <Link to="/characters/new" className="underline">
                    Add someone ({agesLabel(slot)})
                  </Link>
                </p>
              ) : (
                <NativeSelect
                  id={`cast-${slot.slotId}`}
                  value={cast[slot.slotId]}
                  disabled={!hydrated}
                  onChange={(event) => setCast({ ...cast, [slot.slotId]: event.target.value })}
                >
                  {fits(slot).map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
              {(() => {
                const character = characters.find((candidate) => candidate.id === cast[slot.slotId]);
                const missing = character ? notDrawable(manifest, slot.slotId, character) : [];
                return (
                  missing.length > 0 && (
                    <p className="max-w-64 text-xs text-amber-700" data-testid={`cast-warning-${slot.slotId}`}>
                      This story can't draw {character!.name}'s {missing.join(" or ")} yet. You'll pick a stand-in in the book.
                    </p>
                  )
                );
              })()}
            </div>
          ))}
          <Button type="submit" disabled={!hydrated || !ready}>
            Make the book
          </Button>
        </form>
        {error && (
          <p className="text-destructive mt-2 text-sm" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
