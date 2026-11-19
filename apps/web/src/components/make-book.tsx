// Who's in a story: choose a family member for each role, and the pages below draw them with their saved looks
// right away; then make the book. A role can instead try looks on the story's example character, which is a preview
// only and never touches the family. A role accepts some character ages (D29), so only family members of those ages
// are offered, and a look the story can't draw yet is left out of the pictures with a warning (D28, D41).
import { ageLabel, type BookSummary, type Character, type CharacterSlot, type LookAxis, type PreviewRole, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { axisLabels, portraitUrl } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

/** "young child or older child". */
export const agesLabel = (slot: CharacterSlot) => slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ");

/** The select's value for trying looks on the example character. */
export const EXAMPLE = "example";

const missingLabel = (role: PreviewRole) => role.unsupported.map((axis) => axisLabels[axis as LookAxis].toLowerCase()).join(" or ");

export function StoryCast({
  slug,
  slots,
  roles,
  characters,
  books,
  canEdit,
  selected,
  trying,
  onSelect,
  updating,
}: {
  slug: string;
  slots: ReadonlyArray<CharacterSlot>;
  /** Who the pages show now. */
  roles: ReadonlyArray<PreviewRole>;
  characters: ReadonlyArray<Character>;
  /** The family's books of this story already made. */
  books: ReadonlyArray<BookSummary>;
  canEdit: boolean;
  /** What each role's select shows: a character ID, or EXAMPLE. Runs ahead of `roles` while pages recompose. */
  selected: (slotId: string) => string;
  /** Whether the looks picker for the role's example is open. */
  trying: (slotId: string) => boolean;
  onSelect: (slotId: string, value: string) => void;
  updating: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const fits = (slot: CharacterSlot) => characters.filter((character) => slot.ages.includes(character.look.age));
  const everyoneFromFamily = slots.every((slot) => selected(slot.slotId) !== EXAMPLE);

  const create = async () => {
    setMaking(true);
    setError(null);
    try {
      const cast = Object.fromEntries(slots.map((slot) => [slot.slotId, selected(slot.slotId)]));
      const { id } = unwrapResult(CreateBookResult)(await createBookFn({ data: { slug, cast } }));
      await router.navigate({ to: "/books/$bookId", params: { bookId: id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMaking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Who's in this book</h2>
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "Choose who plays each part. The pages below show them with their saved looks right away."
            : "Preview the pages with your family. You're a viewer in this family, so a parent makes the book."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {books.length > 0 && (
          <div className="rounded-md bg-muted/50 p-3 text-sm" data-testid="story-books">
            <p className="font-medium">Your {books.length === 1 ? "book" : "books"} of this story</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {books.map((book) => (
                <li key={book.id}>
                  <Link to="/books/$bookId" params={{ bookId: book.id }} className="underline">
                    {book.title} with {book.cast}
                  </Link>
                </li>
              ))}
            </ul>
            {canEdit && <p className="text-muted-foreground mt-1 text-xs">Open one to edit its text and print it, or make another below.</p>}
          </div>
        )}
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
          {slots.map((slot) => {
            const role = roles.find((candidate) => candidate.slotId === slot.slotId)!;
            const value = selected(slot.slotId);
            const character = characters.find((candidate) => candidate.id === role.characterId);
            const example = value === EXAMPLE;
            return (
              <li key={slot.slotId} className="flex min-w-0 gap-3 rounded-md border p-3" data-testid={`role-${slot.slotId}`}>
                <img src={portraitUrl(role.member.look)} alt="" width={61} height={70} className="h-[70px] w-[61px] shrink-0 rounded-md ring-1 ring-black/10" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                  <label htmlFor={`cast-${slot.slotId}`} className="font-medium">
                    {slot.label} <span className="text-muted-foreground font-normal">({agesLabel(slot)})</span>
                  </label>
                  <NativeSelect id={`cast-${slot.slotId}`} className="w-full min-w-0" value={value} disabled={!hydrated} onChange={(event) => onSelect(slot.slotId, event.target.value)}>
                    {fits(slot).length > 0 && (
                      <optgroup label="Your family">
                        {fits(slot).map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Just previewing">
                      <option value={EXAMPLE}>Try looks on {slot.example.name}, the story's example</option>
                    </optgroup>
                  </NativeSelect>
                  {example ? (
                    <p className="text-muted-foreground text-xs">
                      {fits(slot).length === 0 ? `Nobody in your family is a ${agesLabel(slot)} yet. ` : ""}
                      {slot.example.name} comes with the story.{" "}
                      {trying(slot.slotId) ? (
                        "Looks you try below show on the pages and aren't saved."
                      ) : (
                        <button type="button" className="underline" disabled={!hydrated} onClick={() => onSelect(slot.slotId, EXAMPLE)}>
                          Try looks on {slot.example.name}
                        </button>
                      )}
                      {fits(slot).length === 0 && canEdit && (
                        <>
                          {" "}
                          <Link to="/characters/new" className="underline">
                            Add someone ({agesLabel(slot)})
                          </Link>
                        </>
                      )}
                    </p>
                  ) : (
                    character && (
                      <p className="text-muted-foreground text-xs">
                        Drawn with {character.name}'s saved look.{" "}
                        <Link to="/characters/$characterId" params={{ characterId: character.id }} className="underline">
                          {canEdit ? "Change look" : "See look"}
                        </Link>
                      </p>
                    )
                  )}
                  {role.wrongAge ? (
                    <p className="text-xs text-amber-700" data-testid={`cast-warning-${slot.slotId}`}>
                      {role.member.name} is {ageLabel(role.member.look.age).toLowerCase()}, and this part is for {agesLabel(slot)}, so the pages leave them out.
                    </p>
                  ) : (
                    role.unsupported.length > 0 && (
                      <p className="text-xs text-amber-700" data-testid={`cast-warning-${slot.slotId}`}>
                        This story can't draw {role.characterId ? `${role.member.name}'s ` : ""}
                        {missingLabel(role)} yet, so the pages leave {role.member.name} out.
                        {role.characterId && " In the book you'll pick a stand-in."}
                      </p>
                    )
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={create} disabled={!hydrated || !everyoneFromFamily || making || updating}>
              Make the book
            </Button>
            <p className="text-muted-foreground text-xs">
              {everyoneFromFamily
                ? "Makes a new book with this cast. Next you can edit its text and print a proof."
                : "Choose someone from your family for every part to make the book."}
            </p>
          </div>
        )}
        {error && (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

