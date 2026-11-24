// Who's in a story: choose a family member for each role, then make the book. A role accepts some character ages
// (D29), so only family members of those ages are offered. The pages show the illustrator's stock characters; a
// family's book draws its own people from their photos (D56).
import {
  ageLabel,
  BookExists,
  type BookSummary,
  type Character,
  type CharacterSlot,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

/** "young child or older child". */
export const agesLabel = (slot: CharacterSlot) => slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ");

export function StoryCast({
  slug,
  version,
  slots,
  characters,
  books,
  canEdit,
  archived,
}: {
  slug: string;
  /** The story version the page shows, which a new book would pin. */
  version: number;
  slots: ReadonlyArray<CharacterSlot>;
  characters: ReadonlyArray<Character>;
  /** The family's books of this story already made, newest first. */
  books: ReadonlyArray<BookSummary>;
  canEdit: boolean;
  /** Archived by its author (D49): the page previews it, and no book can be made of it. */
  archived: boolean;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const fits = (slot: CharacterSlot) => characters.filter((character) => slot.ages.includes(character.age));
  // Each role starts with the first family member who fits it.
  const [cast, setCast] = useState<Record<string, string>>(() =>
    Object.fromEntries(slots.flatMap((slot) => (fits(slot)[0] ? [[slot.slotId, fits(slot)[0]!.id]] : []))),
  );
  const everyoneFromFamily = slots.every((slot) => cast[slot.slotId]);

  const create = async () => {
    setMaking(true);
    setError(null);
    try {
      // The books this page lists: the server makes the book only if the family has no other (D47).
      const existing = books.map((book) => book.id);
      const { id } = unwrapResult(CreateBookResult)(await createBookFn({ data: { slug, cast, existing } }));
      await router.navigate({ to: "/books/$bookId", params: { bookId: id } });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setMaking(false);
      // Made in another tab or by another parent since this page loaded: list it.
      if (cause instanceof BookExists) await router.invalidate();
    }
  };
  const [only] = books.length === 1 ? books : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Who's in this book</h2>
        </CardTitle>
        <CardDescription>
          {canEdit
            ? "Choose who plays each part. The pages below show the story's own characters."
            : "You're a viewer in this family, so an owner or editor makes the book."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {books.length > 0 && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
            data-testid="story-books"
            role="status"
          >
            <p className="font-medium">
              {books.length === 1
                ? "Your family already has a book of this story"
                : `Your family already has ${books.length} books of this story`}
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {books.map((book) => (
                <li key={book.id}>
                  <Link to="/books/$bookId" params={{ bookId: book.id }} className="underline">
                    {book.title} with {book.cast}
                  </Link>
                  {book.version !== version && (
                    <span className="text-muted-foreground"> · made from version {book.version}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
          {slots.map((slot) => (
            <li key={slot.slotId} className="flex min-w-0 flex-col gap-1.5 rounded-md border p-3 text-sm">
              <label htmlFor={`cast-${slot.slotId}`} className="font-medium">
                {slot.label} <span className="font-normal text-muted-foreground">({agesLabel(slot)})</span>
              </label>
              {fits(slot).length > 0 ? (
                <NativeSelect
                  id={`cast-${slot.slotId}`}
                  className="w-full min-w-0"
                  value={cast[slot.slotId]}
                  disabled={!hydrated || !canEdit}
                  onChange={(event) => setCast((current) => ({ ...current, [slot.slotId]: event.target.value }))}
                >
                  {fits(slot).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </NativeSelect>
              ) : (
                <p className="text-xs text-muted-foreground" data-testid={`cast-warning-${slot.slotId}`}>
                  Nobody in your family is a {agesLabel(slot)} yet.{" "}
                  {canEdit && (
                    <Link to="/family/new" className="underline">
                      Add someone
                    </Link>
                  )}
                </p>
              )}
            </li>
          ))}
        </ul>
        {canEdit && !archived && (
          <div className="flex flex-wrap items-center gap-3">
            {only && (
              <Button asChild>
                <Link to="/books/$bookId" params={{ bookId: only.id }}>
                  Open our book
                </Link>
              </Button>
            )}
            <Button
              type="button"
              variant={books.length === 0 ? "default" : "outline"}
              onClick={create}
              disabled={!hydrated || !everyoneFromFamily || making}
            >
              {books.length === 0 ? "Make the book" : "Make another copy"}
            </Button>
            {!everyoneFromFamily && (
              <p className="text-xs text-muted-foreground">Add someone from your family for every part first.</p>
            )}
          </div>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
