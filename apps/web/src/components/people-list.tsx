// The People page (D61): the family's people, kept to pick for new books. Each row says who they are, which books
// they're in and the look corrections they bring; parents edit who they are and those corrections for new books, or
// archive them.
import {
  Age,
  ageLabel,
  type FamilyPerson,
  type LookChoices as Corrections,
  unwrapResult,
} from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { lookFields, LookSelect } from "~/components/book/look-fields";
import { draftOf, PersonFields, type PersonDraft, personOf } from "~/components/make-book";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { EditBookResult, setPersonArchivedFn, updatePersonFn } from "~/server/books";

/** Every age: a person isn't tied to one role, so editing them offers all seven. */
const allAges = Age.literals;

const nameOf = (entry: FamilyPerson) =>
  entry.person.title ? `${entry.person.name} (${entry.person.title})` : entry.person.name;

/** The look corrections a person brings to a new book, each named, with a swatch for colours. */
function LookChoices({ entry }: { entry: FamilyPerson }) {
  const set = lookFields.flatMap((field) => {
    const value = entry.person.look?.[field.key];
    const option = field.options.find((candidate) => candidate.id === value);
    return option ? [{ field, option }] : [];
  });
  if (set.length === 0)
    return <p className="text-xs text-muted-foreground">Nothing set. Each book reads their look from its photo.</p>;
  return (
    <ul className="flex flex-wrap items-center gap-1 text-xs" aria-label={`Look you set for ${entry.person.name}`}>
      <li className="text-muted-foreground">You set:</li>
      {set.map(({ field, option }) => (
        <li key={field.key} className="flex items-center gap-1 rounded-full bg-accent px-2">
          {option.swatch && (
            <span
              aria-hidden
              className="size-2.5 rounded-full ring-1 ring-black/20"
              style={{ background: option.swatch }}
            />
          )}
          {field.label}: {option.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The look corrections a new book starts from, with the photo step's controls (Sid, 2026-11-27). "From the photo"
 * leaves an attribute to each book's photo; "Use the photo for everything" clears every correction.
 */
function LookEdit({
  id,
  name,
  look,
  onChange,
}: {
  id: string;
  name: string;
  look: Corrections;
  onChange: (next: Corrections) => void;
}) {
  const set = (key: keyof Corrections, value: string | boolean | undefined) => {
    const next: Record<string, unknown> = { ...look };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next as Corrections);
  };
  const anySet = lookFields.some((field) => look[field.key] !== undefined);
  return (
    <section className="@container flex flex-col gap-2 border-t pt-2" aria-labelledby={`look-edit-${id}`}>
      <p id={`look-edit-${id}`} className="font-medium">
        Look corrections
      </p>
      <p className="text-xs text-muted-foreground">
        Each new book reads {name}'s look from its photo. Set only what the photo would get wrong, like hair they always
        wear differently; you can still change it in each book.
      </p>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-2 @[22rem]:grid-cols-2">
        {lookFields.map((field) => {
          const chosen = look[field.key] !== undefined;
          return (
            <div key={field.key} className="flex flex-col gap-0.5 text-xs">
              <dt className="flex items-center justify-between gap-2 font-medium">
                {field.label}
                <span className={cn("font-normal", chosen ? "text-primary" : "text-muted-foreground")}>
                  {chosen ? "You set this" : "From the photo"}
                </span>
              </dt>
              <LookSelect
                field={field}
                value={look[field.key]}
                emptyLabel="From the photo"
                ariaLabel={`${name}'s ${field.label.toLowerCase()}`}
                idPrefix={`person-${id}`}
                onChange={(value) => set(field.key, value)}
              />
            </div>
          );
        })}
      </dl>
      {anySet && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onChange({})}>
          Use the photo for everything
        </Button>
      )}
    </section>
  );
}

function PersonRow({
  entry,
  canEdit,
  onArchive,
}: {
  entry: FamilyPerson;
  canEdit: boolean;
  onArchive: (entry: FamilyPerson) => Promise<void>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [draft, setDraft] = useState<PersonDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { person } = entry;
  const save = async () => {
    if (!draft) return;
    setError(null);
    try {
      unwrapResult(EditBookResult)(await updatePersonFn({ data: { personId: entry.id, person: personOf(draft) } }));
      setDraft(null);
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm" data-testid={`person-${entry.id}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <p className="font-medium">
            {person.name}
            {person.title && <span className="font-normal text-muted-foreground"> ({person.title})</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {ageLabel(person.age)}, {person.pronouns}.{" "}
            {entry.books.length > 0 && (
              <>
                In{" "}
                {entry.books.map((book, i) => (
                  <span key={book.id}>
                    {i > 0 && ", "}
                    <Link to="/books/$bookId" params={{ bookId: book.id }} className="underline underline-offset-2">
                      {book.title}
                    </Link>
                  </span>
                ))}
              </>
            )}
          </p>
          <LookChoices entry={entry} />
        </div>
        {canEdit && !draft && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!hydrated}
              aria-label={`Edit ${nameOf(entry)}`}
              onClick={() => setDraft(draftOf(person))}
            >
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hydrated}
              aria-label={`Archive ${nameOf(entry)}`}
              onClick={() => void onArchive(entry)}
            >
              Archive
            </Button>
          </div>
        )}
      </div>
      {draft && (
        <form
          className="flex flex-col gap-2 border-t pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <PersonFields
            slot={{ slotId: entry.id, label: person.name, ages: allAges }}
            value={draft}
            onChange={setDraft}
          />
          <LookEdit
            id={entry.id}
            name={draft.name.trim() || person.name}
            look={draft.look ?? {}}
            onChange={(look) => setDraft({ ...draft, look })}
          />
          <p className="text-xs text-muted-foreground">New books use this. Books you've made keep theirs.</p>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={draft.name.trim() === ""}>
              Save
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

export function PeopleList({ people, canEdit }: { people: ReadonlyArray<FamilyPerson>; canEdit: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [archived, setArchived] = useState<FamilyPerson | null>(null);
  const current = people.filter((entry) => !entry.archived);
  const gone = people.filter((entry) => entry.archived);
  const setFor = async (entry: FamilyPerson, value: boolean) => {
    unwrapResult(EditBookResult)(await setPersonArchivedFn({ data: { personId: entry.id, archived: value } }));
    setArchived(value ? entry : null);
    await router.invalidate();
  };

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="What's kept for each person"
        className="grid gap-3 rounded-md border bg-card p-3 text-sm sm:grid-cols-2"
      >
        <div>
          <p className="font-medium">Kept here</p>
          <p>
            Name, what the kids call them (e.g. mom/dad), pronouns, age, and any look you corrected, like hair colour or
            glasses.{canEdit && " Change any of it under Edit for the next books."}
          </p>
        </div>
        <div>
          <p className="font-medium">From each book's photo</p>
          <p>
            Everything else about how they look. Every book asks for a new photo, and your corrections go over what it
            shows. Clear a correction and new books go back to the photo.
          </p>
        </div>
        <p className="border-t pt-2 text-muted-foreground sm:col-span-2">
          Why a new photo each time: we delete photos once you order, so they're never kept with a person, and children
          change between books.
        </p>
      </section>

      {archived && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm"
        >
          {archived.person.name} won't be offered for new books. Their books don't change.
          <Button variant="outline" size="sm" disabled={!hydrated} onClick={() => void setFor(archived, false)}>
            Undo
          </Button>
        </div>
      )}

      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody yet. The people in a book join this list when you order it.{" "}
          <Link to="/stories" className="text-foreground underline underline-offset-4">
            Choose a story
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="people">
          {current.map((entry) => (
            <PersonRow key={entry.id} entry={entry} canEdit={canEdit} onArchive={(chosen) => setFor(chosen, true)} />
          ))}
        </ul>
      )}

      {gone.length > 0 && (
        <details data-testid="archived-people">
          <summary className="cursor-pointer text-sm text-muted-foreground">Archived ({gone.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {gone.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-card p-3 text-sm">
                <div className="min-w-48 flex-1">
                  <p className="font-medium">{nameOf(entry)}</p>
                  <p className="text-xs text-muted-foreground">
                    Not offered for new books.
                    {entry.books.length > 0 && ` Still in ${entry.books.map((book) => book.title).join(", ")}.`}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!hydrated}
                    aria-label={`Restore ${nameOf(entry)}`}
                    onClick={() => void setFor(entry, false)}
                  >
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
