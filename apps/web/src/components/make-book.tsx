// Starting a family's book of a story: choose which family member plays each role. A role draws only faces of its
// age (D26), so only family members of that age are offered.
import { ageOfFace, type Character, type CharacterSlot, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

export function MakeBook({ slug, slots, characters }: { slug: string; slots: ReadonlyArray<CharacterSlot>; characters: ReadonlyArray<Character> }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const fits = (slot: CharacterSlot) => characters.filter((character) => ageOfFace(character.look.face) === slot.age);
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
                {slot.label} <span className="text-muted-foreground font-normal">({slot.age})</span>
              </Label>
              {fits(slot).length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nobody yet.{" "}
                  <Link to="/characters/new" className="underline">
                    Add a {slot.age === "child" ? "child" : "grown-up"}
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
