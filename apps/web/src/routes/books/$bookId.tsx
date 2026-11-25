// A family's book in the editor: who plays each role, every page composed for the book, and the selected page shown
// as it will print, where its text can be edited. Server rendering is
// off (brief, "Recommended design"): the editor is interactive only, and BookPage measures in physical units.
import {
  ageLabel,
  type BookRole,
  type BookView,
  type CastPerson,
  type CharacterSlot,
  NotAuthenticated,
  NotFound,
  resolveText,
  storyAssetKey,
  unwrapResult,
} from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { PageChange, PhotoBookSteps } from "~/components/book/photo-book";
import { ProofPanel } from "~/components/book/ProofPanel";
import { confirmDeleteBook } from "~/components/family-library";
import { draftOf, PersonFields, personOf } from "~/components/make-book";
import { Button } from "~/components/ui/button";
import {
  ApproveProofResult,
  approveProofFn,
  DeleteProofResult,
  deleteProofFn,
  BookProofsResult,
  BookResult,
  EditBookResult,
  getBookFn,
  listBookProofsFn,
  RequestBookProofResult,
  requestBookProofFn,
  saveTextEditFn,
  setBookCastFn,
} from "~/server/books";

export const Route = createFileRoute("/books/$bookId")({
  ssr: false,
  validateSearch: Schema.toStandardSchemaV1(Schema.Struct({ page: Schema.optional(Schema.String) })),
  loader: async ({ params }) => {
    try {
      return unwrapResult(BookResult)(await getBookFn({ data: { bookId: params.bookId } }));
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  pendingComponent: () => <p className="p-8 text-sm">Composing pages…</p>,
  component: BookEditor,
});

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const approveProof = async (proofId: string) => {
  unwrapResult(ApproveProofResult)(await approveProofFn({ data: { proofId } }));
};

const deleteProof = async (proofId: string) => {
  unwrapResult(DeleteProofResult)(await deleteProofFn({ data: { proofId } }));
};

function BookEditor() {
  const { view, canEdit } = Route.useLoaderData();
  const { page: selected } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [error, setError] = useState<string | null>(null);
  /** Paragraphs of the shown page whose frame their text runs past, with this family's names and edits. */
  const [overflowing, setOverflowing] = useState<ReadonlyArray<number>>([]);
  const { manifest, story, version } = view;
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const pageIndex = Math.max(
    0,
    manifest.pages.findIndex((page) => page.pageId === selected),
  );
  const page = manifest.pages[pageIndex]!;
  // Changing pages keeps the window where it is (the router would scroll to the top on every search change).
  const show = (index: number) =>
    void navigate({ search: { page: manifest.pages[index]!.pageId }, replace: true, resetScroll: false });
  // Scrolls the page strip, and only the strip, so the shown page's thumbnail is in view.
  const strip = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = strip.current!;
    const box = list.getBoundingClientRect();
    const item = list.children[pageIndex]!.getBoundingClientRect();
    const by =
      item.left < box.left ? item.left - box.left - 8 : item.right > box.right ? item.right - box.right + 8 : 0;
    if (by) list.scrollBy({ left: by, behavior: "smooth" });
  }, [pageIndex]);

  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    try {
      unwrapResult(EditBookResult)((await call()) as never);
      await router.invalidate();
    } catch (cause) {
      setError(message(cause));
    }
  };

  const bookId = view.book.id;
  const loadProofs = useCallback(
    async () => unwrapResult(BookProofsResult)(await listBookProofsFn({ data: { bookId } })),
    [bookId],
  );
  const requestProof = async () => {
    unwrapResult(RequestBookProofResult)(await requestBookProofFn({ data: { bookId } }));
  };

  const illustration = (index: number) =>
    view.pages[index]!.layers.map((layer) => ({ url: `/api/files/${layer.key}`, rect: layer.rect }));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-1">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="book-title">
          {view.book.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Our edition of {story.title} by {story.authorName} · version {version}
          {!canEdit && " · you're a viewer, so you can read it but not change it"}
        </p>
        {canEdit && (
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={async () => {
              setError(null);
              try {
                const cast = view.roles.map((role) => role.member.name).join(", ");
                if (await confirmDeleteBook({ id: view.book.id, title: view.book.title, cast }))
                  await router.navigate({ to: "/" });
              } catch (cause) {
                setError(message(cause));
              }
            }}
          >
            Delete this book
          </Button>
        )}
      </header>

      <section aria-label="Cast" className="grid items-start gap-3 md:grid-cols-2">
        {manifest.characterSlots.map((slot) => {
          const role = view.roles.find((candidate) => candidate.slotId === slot.slotId);
          // The sheets the order approved (D57); before it, the preview step shows the sheets still being changed.
          const likeness =
            view.flow.status === "draft"
              ? undefined
              : view.flow.likenesses.find((candidate) => candidate.slotId === slot.slotId);
          return role ? (
            <RoleCard
              key={slot.slotId}
              role={role}
              label={slot.label}
              slot={slot}
              sheetUrl={likeness?.sheetKey ? `/api/files/${likeness.sheetKey}` : null}
              expressionsUrl={likeness?.expressionsKey ? `/api/files/${likeness.expressionsKey}` : null}
              canEdit={canEdit}
              onSave={(person) =>
                run(() => setBookCastFn({ data: { bookId: view.book.id, slotId: slot.slotId, person } }))
              }
            />
          ) : null;
        })}
      </section>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <PhotoBookSteps view={view} canEdit={canEdit} />

      <section aria-label="Editor" className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              Page {pageIndex + 1} of {manifest.pages.length}, as it will print ({manifest.trim.widthIn} ×{" "}
              {manifest.trim.heightIn} in plus bleed)
            </span>
            <span className="flex shrink-0 gap-1">
              <Button variant="outline" size="sm" disabled={pageIndex === 0} onClick={() => show(pageIndex - 1)}>
                ← Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={pageIndex === manifest.pages.length - 1}
                onClick={() => show(pageIndex + 1)}
              >
                Next →
              </Button>
            </span>
          </div>
          <div className="w-fit rounded-sm shadow-md ring-1 ring-black/10" data-testid="editor-page">
            <ScaledPage trim={manifest.trim} scale={0.72}>
              <TextDraftPage
                key={page.pageId}
                view={view}
                pageIndex={pageIndex}
                illustration={illustration(pageIndex)}
                onOverflow={setOverflowing}
              />
            </ScaledPage>
          </div>
          <PageChange key={`change-${page.pageId}`} view={view} pageId={page.pageId} canEdit={canEdit} />
          {/* Under the page, in its column: the text editor beside or below it can grow and shrink with each page's
              paragraphs without moving the strip. As wide as the page, not as all the thumbnails in one row. */}
          <section aria-label="All pages" className="w-0 min-w-full">
            <ol ref={strip} className="flex gap-2 overflow-x-auto p-1 pb-2">
              {manifest.pages.map((candidate, i) => (
                <li key={candidate.pageId} className="shrink-0">
                  <button
                    type="button"
                    aria-label={`Page ${i + 1}`}
                    aria-current={i === pageIndex ? "page" : undefined}
                    onClick={() => show(i)}
                    className="group flex flex-col items-center gap-1"
                  >
                    <span
                      className={`block w-fit rounded-sm ring-1 ring-black/10 ${i === pageIndex ? "ring-2 ring-foreground" : "group-hover:ring-black/40"}`}
                    >
                      <ScaledPage trim={manifest.trim} scale={0.14}>
                        <BookPage
                          manifest={manifest}
                          page={candidate}
                          text={view.pages[i]!.text.map((block) => ({ style: block.style, text: block.text }))}
                          illustration={illustration(i)}
                          cast={view.cast}
                        />
                      </ScaledPage>
                    </span>
                    <span
                      className={`text-xs tabular-nums ${i === pageIndex ? "font-semibold text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}
                    >
                      {i + 1}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <TextEditor
          key={`${page.pageId}`}
          view={view}
          pageIndex={pageIndex}
          canEdit={canEdit}
          overflowing={overflowing}
          onSave={(blockIndex, content) =>
            run(() => saveTextEditFn({ data: { bookId: view.book.id, pageId: page.pageId, blockIndex, content } }))
          }
        />
      </section>

      {/* Proofs are of the drawn book (D57), from page changes on. */}
      {!["draft", "ordered", "making"].includes(view.flow.status) && (
        <ProofPanel load={loadProofs} request={requestProof} approve={approveProof} remove={deleteProof} hydrated />
      )}
    </main>
  );
}

// Drafts typed into the text editor show on the page before they're saved, through this small shared store.
const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const setDraft = (key: string, value: string | null) => {
  if (value === null) drafts.delete(key);
  else drafts.set(key, value);
  for (const listener of listeners) listener();
};
const useDrafts = () => {
  const [, force] = useState(0);
  useState(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  });
  return drafts;
};

function TextDraftPage({
  view,
  pageIndex,
  illustration,
  onOverflow,
}: {
  view: BookView;
  pageIndex: number;
  illustration: ReadonlyArray<{ url: string; rect: readonly [number, number, number, number] }>;
  /** Told which paragraphs (in pageText order) sit in a frame their text runs past. */
  onOverflow: (blocks: ReadonlyArray<number>) => void;
}) {
  const current = useDrafts();
  const page = view.manifest.pages[pageIndex]!;
  const text = view.pages[pageIndex]!.text.map((block, i) => {
    const draft = current.get(`${page.pageId}/${i}`);
    return { style: block.style, text: draft === undefined ? block.text : resolveText(draft, view.cast) };
  });
  return (
    <BookPage
      manifest={view.manifest}
      page={page}
      text={text}
      illustration={illustration}
      cast={view.cast}
      // BookPage names frames; the text editor lists paragraphs, so a frame's overflow marks each of its paragraphs.
      onOverflow={(frames) =>
        onOverflow(
          page.frames.flatMap((frame, f) => {
            const first = page.frames.slice(0, f).reduce((n, earlier) => n + earlier.paragraphs.length, 0);
            return frames.includes(f) ? frame.paragraphs.map((_p, i) => first + i) : [];
          }),
        )
      }
    />
  );
}

function TextEditor({
  view,
  pageIndex,
  canEdit,
  overflowing,
  onSave,
}: {
  view: BookView;
  pageIndex: number;
  canEdit: boolean;
  overflowing: ReadonlyArray<number>;
  onSave: (blockIndex: number, content: string | null) => Promise<void>;
}) {
  const page = view.manifest.pages[pageIndex]!;
  const blocks = view.pages[pageIndex]!.text;
  const [values, setValues] = useState(() => blocks.map((block) => block.edited ?? block.original));
  const tokens = view.manifest.characterSlots.map((slot) => `{{${slot.slotId}.name}}`).join(", ");

  return (
    <div className="flex flex-col gap-4" aria-label="Page text">
      <p className="text-sm font-medium">Text on this page</p>
      {blocks.map((block, i) => {
        const key = `${page.pageId}/${i}`;
        const dirty = values[i] !== (block.edited ?? block.original);
        return (
          <div key={key} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                {block.style === "title" ? "Title" : `Paragraph ${i + 1}`}
                {block.edited !== null && " · edited"}
              </span>
              <textarea
                aria-label={`Text block ${i + 1}`}
                className="min-h-24 rounded-md border bg-transparent p-2 text-sm"
                value={values[i]}
                readOnly={!canEdit}
                onChange={(event) => {
                  const next = values.with(i, event.target.value);
                  setValues(next);
                  setDraft(key, event.target.value);
                }}
              />
            </label>
            {overflowing.includes(i) && (
              <p role="alert" className="text-xs text-destructive">
                This text runs past the space the story gives it on the page. Shorten it, or use the story's text.
              </p>
            )}
            {canEdit && (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  aria-label={`Save text block ${i + 1}`}
                  disabled={!dirty}
                  onClick={async () => {
                    await onSave(i, values[i]!);
                    setDraft(key, null);
                  }}
                >
                  Save text
                </Button>
                {block.edited !== null && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Use the story's text for block ${i + 1}`}
                    onClick={async () => {
                      await onSave(i, null);
                      setValues(values.with(i, block.original));
                      setDraft(key, null);
                    }}
                  >
                    Use the story's text
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-xs text-muted-foreground">
        Names, titles, and pronouns fill in from the cast: {tokens},{" "}
        {`{{${view.manifest.characterSlots.at(-1)!.slotId}.title}}`} (what the kids call them), {`{{hero.they}}`},{" "}
        {`{{hero.their}}`}…; a verb after a pronoun: {`{{hero:knows|know}}`} (she knows, they know).
      </p>
    </div>
  );
}

/**
 * Who plays a role, with their approved character sheet once the book is ordered (a thumbnail that opens it across
 * the card), and for an owner or editor, a form to change their name, title, pronouns or age.
 */
function RoleCard({
  role,
  label,
  slot,
  sheetUrl,
  expressionsUrl,
  canEdit,
  onSave,
}: {
  role: BookRole;
  label: string;
  slot: CharacterSlot;
  sheetUrl: string | null;
  /** The person's six expressions, drawn with the sheet; null on sheets drawn before them. */
  expressionsUrl: string | null;
  canEdit: boolean;
  onSave: (person: CastPerson) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [edited, setPerson] = useState(() => draftOf(role.person));
  const { person } = role;
  const sheetAlt = `${person.name}'s character sheet`;
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid={`role-${role.slotId}`}>
      <div className="flex items-center gap-3">
        {sheetUrl && (
          <button
            type="button"
            aria-expanded={sheetOpen}
            aria-label={sheetAlt}
            onClick={() => setSheetOpen(!sheetOpen)}
            className="shrink-0 overflow-hidden rounded ring-1 ring-black/10 hover:ring-black/40"
          >
            <img src={sheetUrl} alt="" className="aspect-[3/2] w-20 object-cover sm:w-24" />
          </button>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{label}:</span>
          <span>
            {person.name}
            <span className="text-muted-foreground">
              {" · "}
              {[person.title, person.pronouns, ageLabel(person.age).toLowerCase()].filter(Boolean).join(" · ")}
            </span>
          </span>
          {canEdit && !editing && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline"
              onClick={() => {
                setPerson(draftOf(person));
                setEditing(true);
              }}
            >
              Change
            </button>
          )}
        </div>
      </div>
      {sheetUrl && sheetOpen && (
        <div className="flex flex-col gap-3">
          <figure className="flex flex-col gap-1">
            <img src={sheetUrl} alt={sheetAlt} className="w-full rounded ring-1 ring-black/10" />
            <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
              <span>Every page of this book is drawn from this sheet.</span>
              <a href={sheetUrl} target="_blank" rel="noreferrer" className="underline">
                Open full size
              </a>
            </figcaption>
          </figure>
          {expressionsUrl && (
            <figure className="flex flex-col gap-1">
              <img
                src={expressionsUrl}
                alt={`${person.name} in six expressions`}
                className="w-full rounded ring-1 ring-black/10"
              />
              <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
                <span>The same face in six expressions, drawn with the sheet.</span>
                <a href={expressionsUrl} target="_blank" rel="noreferrer" className="underline">
                  Open full size
                </a>
              </figcaption>
            </figure>
          )}
        </div>
      )}
      {editing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            await onSave(personOf(edited));
            setEditing(false);
          }}
        >
          <PersonFields slot={slot} value={edited} onChange={setPerson} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={edited.name.trim() === ""}>
              Save
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
