// Who's in a story: choose a family member for each role, and the pages below draw them with their saved looks
// right away; then make the book. A role can instead try looks on the story's example character, which is a preview
// only and never touches the family. A role accepts some character ages (D29), so only family members of those ages
// are offered, and a look the story can't draw yet is left out of the pictures with a warning (D28, D41).
import {
  ageLabel,
  BookExists,
  type BookSummary,
  type Character,
  type CharacterSlot,
  type LookAxis,
  type LookOverride,
  type PreviewRole,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { lookPickerId, lookToggleId } from "~/components/book-look";
import { axisLabels, portraitUrl } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

/** "young child or older child". */
export const agesLabel = (slot: CharacterSlot) => slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ");

/** The select's value for trying looks on the example character. */
export const EXAMPLE = "example";

/** The IDs of the picker for trying looks on a role's example, and of the button that shows and hides it. */
export const tryPickerId = (slotId: string) => `try-picker-${slotId}`;
export const tryToggleId = (slotId: string) => `try-toggle-${slotId}`;

const missingLabel = (role: PreviewRole) =>
  role.unsupported.map((axis) => axisLabels[axis as LookAxis].toLowerCase()).join(" or ");

export function StoryCast({
  slug,
  version,
  slots,
  roles,
  characters,
  books,
  canEdit,
  archived,
  selected,
  trying,
  onTry,
  onSelect,
  changes,
  styling,
  onStyle,
  updating,
}: {
  slug: string;
  /** The story version the page shows, which a new book would pin. */
  version: number;
  slots: ReadonlyArray<CharacterSlot>;
  /** Who the pages show now. */
  roles: ReadonlyArray<PreviewRole>;
  characters: ReadonlyArray<Character>;
  /** The family's books of this story already made, newest first. */
  books: ReadonlyArray<BookSummary>;
  canEdit: boolean;
  /** Archived by its author (D49): the page previews it, and no book can be made of it. */
  archived: boolean;
  /** What each role's select shows: a character ID, or EXAMPLE. Runs ahead of `roles` while pages recompose. */
  selected: (slotId: string) => string;
  /** Whether the looks picker for the role's example is open, and showing or hiding it. */
  trying: (slotId: string) => boolean;
  onTry: (slotId: string, open: boolean) => void;
  onSelect: (slotId: string, value: string) => void;
  /** How the book will draw each role's family member differently from their saved look (D46), not saved yet. */
  changes: (slotId: string) => LookOverride;
  /** Whether the role's "look in this book" picker is open, and showing or hiding it. */
  styling: (slotId: string) => boolean;
  onStyle: (slotId: string, open: boolean) => void;
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
      const looks = Object.fromEntries(slots.map((slot) => [slot.slotId, changes(slot.slotId)]));
      // The books this page lists: the server makes the book only if the family has no other (D47).
      const existing = books.map((book) => book.id);
      const { id } = unwrapResult(CreateBookResult)(await createBookFn({ data: { slug, cast, looks, existing } }));
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
            ? "Choose who plays each part. The pages below show them with their saved looks right away."
            : "Preview the pages with your family. You're a viewer in this family, so a parent makes the book."}
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
            {canEdit && (
              <p className="mt-1 text-xs text-muted-foreground">
                {books.length === 1 ? "Open it" : "Choose one to open"} to change who's in it, edit its text, and print
                it. Opening it keeps its cast and looks as they are; the choices below aren't applied to it.
              </p>
            )}
          </div>
        )}
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
          {slots.map((slot) => {
            const role = roles.find((candidate) => candidate.slotId === slot.slotId)!;
            const value = selected(slot.slotId);
            const character = characters.find((candidate) => candidate.id === role.characterId);
            const example = value === EXAMPLE;
            return (
              <li
                key={slot.slotId}
                className="flex min-w-0 gap-3 rounded-md border p-3"
                data-testid={`role-${slot.slotId}`}
              >
                <img
                  src={portraitUrl(role.member.look)}
                  alt=""
                  width={61}
                  height={70}
                  className="h-[70px] w-[61px] shrink-0 rounded-md ring-1 ring-black/10"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
                  <label htmlFor={`cast-${slot.slotId}`} className="font-medium">
                    {slot.label} <span className="font-normal text-muted-foreground">({agesLabel(slot)})</span>
                  </label>
                  <NativeSelect
                    id={`cast-${slot.slotId}`}
                    className="w-full min-w-0"
                    value={value}
                    disabled={!hydrated}
                    onChange={(event) => onSelect(slot.slotId, event.target.value)}
                  >
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
                    <p className="text-xs text-muted-foreground">
                      {fits(slot).length === 0 ? `Nobody in your family is a ${agesLabel(slot)} yet. ` : ""}
                      {slot.example.name} comes with the story.{" "}
                      {trying(slot.slotId) && "Looks you try below show on the pages and aren't saved. "}
                      <button
                        type="button"
                        id={tryToggleId(slot.slotId)}
                        className="underline"
                        aria-expanded={trying(slot.slotId)}
                        aria-controls={trying(slot.slotId) ? tryPickerId(slot.slotId) : undefined}
                        disabled={!hydrated}
                        onClick={() => onTry(slot.slotId, !trying(slot.slotId))}
                      >
                        {trying(slot.slotId) ? "Hide look options" : `Try looks on ${slot.example.name}`}
                      </button>
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
                      <p className="text-xs text-muted-foreground" data-testid={`look-note-${slot.slotId}`}>
                        {Object.keys(changes(slot.slotId)).length > 0
                          ? `Drawn with a look for this book only, not ${character.name}'s saved one.`
                          : `Drawn with ${character.name}'s saved look.`}{" "}
                        <button
                          type="button"
                          id={lookToggleId(slot.slotId)}
                          className="underline"
                          aria-expanded={styling(slot.slotId)}
                          aria-controls={styling(slot.slotId) ? lookPickerId(slot.slotId) : undefined}
                          disabled={!hydrated}
                          onClick={() => onStyle(slot.slotId, !styling(slot.slotId))}
                        >
                          {styling(slot.slotId) ? "Hide look options" : "Change look for this book"}
                        </button>
                      </p>
                    )
                  )}
                  {role.wrongAge ? (
                    <p className="text-xs text-amber-700" data-testid={`cast-warning-${slot.slotId}`}>
                      {role.member.name} is {ageLabel(role.member.look.age).toLowerCase()}, and this part is for{" "}
                      {agesLabel(slot)}, so the pages leave them out.
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
        {canEdit &&
          !archived &&
          (books.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={create} disabled={!hydrated || !everyoneFromFamily || making || updating}>
                Make the book
              </Button>
              <p className="text-xs text-muted-foreground">
                {everyoneFromFamily
                  ? "Makes a new book with this cast. Next you can edit its text and print a proof."
                  : "Choose someone from your family for every part to make the book."}
              </p>
            </div>
          ) : (
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
                variant="outline"
                onClick={create}
                disabled={!hydrated || !everyoneFromFamily || making || updating}
              >
                Make another copy
              </Button>
              <p className="text-xs text-muted-foreground">
                {everyoneFromFamily
                  ? `Makes a separate book with this cast; ${books.length === 1 ? "your book stays" : "your books stay"} as ${books.length === 1 ? "it is" : "they are"}.`
                  : "Choose someone from your family for every part to make another copy."}
              </p>
            </div>
          ))}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
