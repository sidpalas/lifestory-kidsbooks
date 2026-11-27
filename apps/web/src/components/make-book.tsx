// Who's in a story: for each role, the person's name, what the kids call them (adults only), pronouns and an age the role accepts
// (D29), typed in or picked from the family's earlier books; then make the book. The pages show the illustrator's stock
// characters; a family's book draws its own people from their photos (D56).
import {
  ageLabel,
  BookExists,
  type BookSummary,
  Age,
  type CastPerson,
  type CharacterSlot,
  PronounSet,
  takesTitle,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { NativeSelect } from "~/components/ui/native-select";
import { createBookFn, CreateBookResult } from "~/server/books";

/** "young child or older child". */
export const agesLabel = (slot: CharacterSlot) => slot.ages.map((age) => ageLabel(age).toLowerCase()).join(" or ");

/** Suggestions only: families use many words and spellings, so the field takes any text. */
const titleSuggestions = [
  "Mum",
  "Mom",
  "Dad",
  "Mama",
  "Papa",
  "Grandma",
  "Grandpa",
  "Nana",
  "Granny",
  "Auntie",
  "Uncle",
];

/** A person in progress: the title as typed, empty for none; kept while the age is a child's, so switching back restores it. */
export type PersonDraft = { name: string; title: string; pronouns: PronounSet; age: Age; personId?: string | null };

export const draftOf = (person: CastPerson): PersonDraft => ({ ...person, title: person.title ?? "" });
export const blankFor = (slot: CharacterSlot): PersonDraft => ({
  name: "",
  title: "",
  pronouns: slot.example.pronouns,
  age: slot.ages[0]!,
});
export const personOf = (draft: PersonDraft): CastPerson => ({
  name: draft.name.trim(),
  title: (takesTitle(draft.age) && draft.title.trim()) || null,
  pronouns: draft.pronouns,
  age: draft.age,
  // The person it was picked as (D61), edits and all; null for someone new.
  personId: draft.personId ?? null,
});

/** Who plays one role: name, what the kids call them (only for an adult age), pronouns, and an age the role accepts. */
export function PersonFields({
  slot,
  value,
  onChange,
  disabled,
}: {
  slot: Pick<CharacterSlot, "slotId" | "label" | "ages">;
  value: PersonDraft;
  onChange: (next: PersonDraft) => void;
  disabled?: boolean;
}) {
  const id = (field: string) => `${slot.slotId}-${field}`;
  return (
    <fieldset className="grid gap-2 sm:grid-cols-2" disabled={disabled} aria-label={slot.label}>
      <label htmlFor={id("name")} className="flex flex-col justify-between gap-1 text-xs font-medium">
        Name
        <Input
          id={id("name")}
          value={value.name}
          required
          maxLength={60}
          onChange={(event) => onChange({ ...value, name: event.target.value })}
        />
      </label>
      {takesTitle(value.age) && (
        <label htmlFor={id("title")} className="flex flex-col justify-between gap-1 text-xs font-medium">
          <span>
            What the kids call them <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <Input
            id={id("title")}
            value={value.title}
            maxLength={30}
            list="person-titles"
            placeholder="Dad, Nana…"
            onChange={(event) => onChange({ ...value, title: event.target.value })}
          />
        </label>
      )}
      <label htmlFor={id("pronouns")} className="flex flex-col justify-between gap-1 text-xs font-medium">
        Pronouns
        <NativeSelect
          id={id("pronouns")}
          value={value.pronouns}
          onChange={(event) => onChange({ ...value, pronouns: event.target.value as PronounSet })}
        >
          {PronounSet.literals.map((set) => (
            <option key={set} value={set}>
              {set}
            </option>
          ))}
        </NativeSelect>
      </label>
      <label htmlFor={id("age")} className="flex flex-col justify-between gap-1 text-xs font-medium">
        Age
        <NativeSelect
          id={id("age")}
          value={value.age}
          onChange={(event) => onChange({ ...value, age: event.target.value as Age })}
        >
          {slot.ages.map((age) => (
            <option key={age} value={age}>
              {ageLabel(age)}
            </option>
          ))}
        </NativeSelect>
      </label>
      <datalist id="person-titles">
        {titleSuggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </fieldset>
  );
}

const choiceClass =
  "cursor-pointer rounded px-2.5 py-1 text-muted-foreground has-checked:bg-background has-checked:text-foreground has-checked:shadow-sm has-focus-visible:ring-2 has-focus-visible:ring-ring";

/**
 * Who plays a role (D61): someone from the family's people, or someone new, an explicit choice on every role once the
 * family has people. A picked person stays that person when the parent edits their details, and the order updates them
 * for later books; someone new never changes an existing person. A role nobody fits yet starts on someone new, and its
 * "From your people" says why nobody is offered; a family with no people sees only the fields.
 */
export function PersonChooser({
  slot,
  value,
  onChange,
  people,
  disabled,
}: {
  slot: CharacterSlot;
  value: PersonDraft;
  onChange: (next: PersonDraft) => void;
  /** The family's people that aren't archived; those of an age the role accepts are offered. */
  people: ReadonlyArray<CastPerson>;
  disabled?: boolean;
}) {
  const fits = people.filter((person) => slot.ages.includes(person.age));
  const canPick = fits.length > 0;
  const [mode, setMode] = useState<"people" | "new">(() =>
    value.personId || (canPick && value.name.trim() === "") ? "people" : "new",
  );
  const [editing, setEditing] = useState(false);
  const picked = value.personId ? (people.find((person) => person.personId === value.personId) ?? null) : null;
  const choose = (next: "people" | "new") => {
    setMode(next);
    setEditing(false);
    onChange({ ...blankFor(slot), personId: null });
  };
  return (
    <div className="flex flex-col gap-2">
      {(people.length > 0 || value.personId) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="radiogroup"
            aria-label={`Who plays ${slot.label.toLowerCase()}`}
            className="flex w-fit rounded-md bg-muted p-0.5 text-xs"
          >
            <label className={choiceClass}>
              <input
                type="radio"
                className="sr-only"
                name={`${slot.slotId}-who`}
                checked={mode === "people"}
                disabled={disabled}
                onChange={() => choose("people")}
              />
              From your people
            </label>
            <label className={choiceClass}>
              <input
                type="radio"
                className="sr-only"
                name={`${slot.slotId}-who`}
                checked={mode === "new"}
                disabled={disabled}
                onChange={() => choose("new")}
              />
              Someone new
            </label>
          </div>
          <Link
            to="/people"
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Manage people
          </Link>
        </div>
      )}
      {mode === "people" && !value.personId && !canPick && (
        <p
          className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground"
          data-testid={`${slot.slotId}-nobody-fits`}
        >
          None of your people can play this part yet: it's for {agesLabel(slot)}. Choose Someone new; they join your
          people when you order the book.
        </p>
      )}
      {mode === "people" && !value.personId && canPick && (
        <NativeSelect
          aria-label={`${slot.label}: choose from your people`}
          value=""
          disabled={disabled}
          onChange={(event) => {
            const person = fits[Number(event.target.value)];
            if (person) onChange(draftOf(person));
          }}
        >
          <option value="">Choose…</option>
          {fits.map((person, i) => (
            <option key={i} value={i}>
              {person.title ? `${person.name} (${person.title})` : person.name}
            </option>
          ))}
        </NativeSelect>
      )}
      {mode === "people" && value.personId && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-2">
          <p data-testid={`${slot.slotId}-picked`}>
            <span className="font-medium">{value.name}</span>
            {takesTitle(value.age) && value.title.trim() && (
              <span className="text-muted-foreground"> ({value.title.trim()})</span>
            )}
            <span className="text-muted-foreground">
              {" · "}
              {ageLabel(value.age)} · {value.pronouns}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            {!editing && (
              <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => choose("people")}>
              Choose someone else
            </Button>
          </div>
          {editing && (
            <>
              <PersonFields slot={slot} value={value} disabled={disabled} onChange={onChange} />
              <p className="text-xs text-muted-foreground">
                This changes {picked?.name ?? value.name} for your next books too. Books you've made keep theirs.
              </p>
            </>
          )}
        </div>
      )}
      {mode === "new" && <PersonFields slot={slot} value={value} disabled={disabled} onChange={onChange} />}
    </div>
  );
}

export function StoryCast({
  slug,
  version,
  slots,
  people,
  books,
  canEdit,
  archived,
}: {
  slug: string;
  /** The story version the page shows, which a new book would pin. */
  version: number;
  slots: ReadonlyArray<CharacterSlot>;
  /** The people in the family's books, to pick instead of typing them again. */
  people: ReadonlyArray<CastPerson>;
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
  const [cast, setCast] = useState<Record<string, PersonDraft>>(() =>
    Object.fromEntries(slots.map((slot) => [slot.slotId, blankFor(slot)])),
  );
  const everyoneNamed = slots.every((slot) => cast[slot.slotId]!.name.trim() !== "");

  const create = async () => {
    setMaking(true);
    setError(null);
    try {
      // The books this page lists: the server makes the book only if the family has no other (D47).
      const existing = books.map((book) => book.id);
      const chosen = Object.fromEntries(slots.map((slot) => [slot.slotId, personOf(cast[slot.slotId]!)]));
      const { id } = unwrapResult(CreateBookResult)(await createBookFn({ data: { slug, cast: chosen, existing } }));
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
            ? "Say who plays each part. The pages below show the story's own characters; your book draws your family from their photos."
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
        {canEdit && (
          <ul className="grid gap-3 md:grid-cols-2" aria-label="Roles">
            {slots.map((slot) => (
              <li
                key={slot.slotId}
                className="flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm"
                data-testid={`role-${slot.slotId}`}
              >
                <p className="font-medium">
                  {slot.label} <span className="font-normal text-muted-foreground">({agesLabel(slot)})</span>
                </p>
                <PersonChooser
                  slot={slot}
                  value={cast[slot.slotId]!}
                  people={people}
                  disabled={!hydrated}
                  onChange={(next) => setCast((current) => ({ ...current, [slot.slotId]: next }))}
                />
              </li>
            ))}
          </ul>
        )}
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
              disabled={!hydrated || !everyoneNamed || making}
            >
              {books.length === 0 ? "Make the book" : "Make another copy"}
            </Button>
            {!everyoneNamed && <p className="text-xs text-muted-foreground">Name someone for every part first.</p>}
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
