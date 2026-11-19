// A family's book in the editor: who plays each role, every page composed from the cast's looks with the story's
// approved parts, and the selected page shown as it will print, where its text can be edited. Server rendering is
// off (brief, "Recommended design"): the editor is interactive only, and BookPage measures in physical units.
import {
  ageLabel,
  type BookRole,
  type BookView,
  castLook,
  type Character,
  type CharacterSlot,
  type Look,
  type LookAxis,
  lookVocabulary,
  NotAuthenticated,
  NotFound,
  resolveText,
  storyAssetKey,
  unwrapResult,
} from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { useCallback, useState } from "react";
import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { ProofPanel } from "~/components/book/ProofPanel";
import { axisLabels, portraitUrl } from "~/components/look-picker";
import { agesLabel } from "~/components/make-book";
import { Button } from "~/components/ui/button";
import { NativeSelect } from "~/components/ui/native-select";
import {
  ApproveProofResult,
  approveProofFn,
  BookProofsResult,
  BookResult,
  EditBookResult,
  getBookFn,
  listBookProofsFn,
  RequestBookProofResult,
  requestBookProofFn,
  saveTextEditFn,
  setBookCastFn,
  setLookOverrideFn,
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

function BookEditor() {
  const { view, canEdit, characters } = Route.useLoaderData();
  const { page: selected } = Route.useSearch();
  const router = useRouter();
  const navigate = Route.useNavigate();
  const [guides, setGuides] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { manifest, story, version } = view;
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const pageIndex = Math.max(0, manifest.pages.findIndex((page) => page.pageId === selected));
  const page = manifest.pages[pageIndex]!;

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
  const loadProofs = useCallback(async () => unwrapResult(BookProofsResult)(await listBookProofsFn({ data: { bookId } })), [bookId]);
  const requestProof = async () => {
    unwrapResult(RequestBookProofResult)(await requestBookProofFn({ data: { bookId } }));
  };

  const illustration = (index: number) => view.pages[index]!.layers.map((layer) => ({ url: `/api/files/${layer.key}`, rect: layer.rect }));

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-1">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="book-title">
          {view.book.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          Our edition of {story.title} by {story.authorName} · version {version}
          {!canEdit && " · you're a viewer, so you can read it but not change it"}
        </p>
      </header>

      <section aria-label="Cast" className="grid gap-3 md:grid-cols-2">
        {manifest.characterSlots.map((slot) => {
          const role = view.roles.find((candidate) => candidate.slotId === slot.slotId);
          return role ? (
            <RoleCard
              key={slot.slotId}
              view={view}
              role={role}
              label={slot.label}
              slot={slot}
              characters={characters}
              canEdit={canEdit}
              onCast={(characterId) => run(() => setBookCastFn({ data: { bookId: view.book.id, slotId: slot.slotId, characterId } }))}
              onOverride={(override) => run(() => setLookOverrideFn({ data: { bookId: view.book.id, slotId: slot.slotId, override } }))}
            />
          ) : null;
        })}
      </section>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      <section aria-label="Editor" className="grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-sm">
            <span>
              Page {pageIndex + 1} of {manifest.pages.length}, as it will print ({manifest.trim.widthIn} × {manifest.trim.heightIn} in plus bleed)
            </span>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={guides} onChange={(event) => setGuides(event.target.checked)} />
              Guides
            </label>
          </div>
          <div className="w-fit rounded-sm shadow-md ring-1 ring-black/10" data-testid="editor-page">
            <ScaledPage trim={manifest.trim} scale={0.72}>
              <TextDraftPage key={page.pageId} view={view} pageIndex={pageIndex} illustration={illustration(pageIndex)} guides={guides} />
            </ScaledPage>
          </div>
        </div>
        <TextEditor
          key={`${page.pageId}`}
          view={view}
          pageIndex={pageIndex}
          canEdit={canEdit}
          onSave={(blockIndex, content) => run(() => saveTextEditFn({ data: { bookId: view.book.id, pageId: page.pageId, blockIndex, content } }))}
        />
      </section>

      <ProofPanel load={loadProofs} request={requestProof} approve={approveProof} hydrated />

      <section aria-label="All pages">
        <ol className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {manifest.pages.map((candidate, i) => (
            <li key={candidate.pageId}>
              <button
                type="button"
                aria-label={`Page ${i + 1}`}
                aria-current={i === pageIndex ? "page" : undefined}
                onClick={() => void navigate({ search: { page: candidate.pageId }, replace: true })}
                className={`block w-fit rounded-sm ring-1 ring-black/10 ${i === pageIndex ? "ring-2 ring-foreground" : "hover:ring-black/40"}`}
              >
                <ScaledPage trim={manifest.trim} scale={0.3}>
                  <BookPage
                    manifest={manifest}
                    page={candidate}
                    text={view.pages[i]!.text.map((block) => ({ style: block.style, text: block.text }))}
                    illustration={illustration(i)}
                    cast={view.cast}
                  />
                </ScaledPage>
              </button>
            </li>
          ))}
        </ol>
      </section>
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

function TextDraftPage({ view, pageIndex, illustration, guides }: { view: BookView; pageIndex: number; illustration: ReadonlyArray<{ url: string; rect: readonly [number, number, number, number] }>; guides: boolean }) {
  const current = useDrafts();
  const page = view.manifest.pages[pageIndex]!;
  const text = view.pages[pageIndex]!.text.map((block, i) => {
    const draft = current.get(`${page.pageId}/${i}`);
    return { style: block.style, text: draft === undefined ? block.text : resolveText(draft, view.cast) };
  });
  return <BookPage manifest={view.manifest} page={page} text={text} illustration={illustration} cast={view.cast} guides={guides} />;
}

function TextEditor({
  view,
  pageIndex,
  canEdit,
  onSave,
}: {
  view: BookView;
  pageIndex: number;
  canEdit: boolean;
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
      <p className="text-muted-foreground text-xs">Names, titles, and pronouns fill in from the cast: {tokens}, {`{{${view.manifest.characterSlots.at(-1)!.slotId}.title}}`} (what the kids call them), {`{{hero.they}}`}, {`{{hero.their}}`}…</p>
    </div>
  );
}

function RoleCard({
  view,
  role,
  label,
  slot,
  characters,
  canEdit,
  onCast,
  onOverride,
}: {
  view: BookView;
  role: BookRole;
  label: string;
  slot: CharacterSlot;
  characters: ReadonlyArray<Character>;
  canEdit: boolean;
  onCast: (characterId: string) => void;
  onOverride: (override: Partial<Look>) => void;
}) {
  const character = characters.find((candidate) => candidate.id === role.characterId);
  const fits = characters.filter((candidate) => slot.ages.includes(candidate.look.age) || candidate.id === role.characterId);
  // For each unsupported axis, the options this story version can draw for this role, given the rest of the look.
  const supported = (axis: LookAxis) =>
    lookVocabulary[axis].filter((option) => !castLook(view.manifest, role.slotId, role.member.look, { ...role.override, [axis]: option.id }).unsupported.includes(axis));

  return (
    <div className="flex gap-3 rounded-md border p-3" data-testid={`role-${role.slotId}`}>
      <img src={portraitUrl(role.member.look)} alt="" width={61} height={70} className="h-[70px] rounded-md ring-1 ring-black/10" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{label}:</span>
          {canEdit ? (
            <NativeSelect aria-label={`Who plays ${label.toLowerCase()}`} value={role.characterId} onChange={(event) => onCast(event.target.value)}>
              {fits.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <span>{role.member.name}</span>
          )}
          {character && (
            <Link to="/characters/$characterId" params={{ characterId: character.id }} className="text-muted-foreground text-xs underline">
              {canEdit ? "Change look" : "See look"}
            </Link>
          )}
        </div>
        {role.wrongAge ? (
          <p className="text-destructive" role="status">
            {role.member.name} is {ageLabel(role.member.look.age).toLowerCase()} now, and this role is for {agesLabel(slot)}, so the pages leave them out.
            Choose someone else for {label.toLowerCase()}.
          </p>
        ) : role.unsupported.length > 0 ? (
          <div className="flex flex-col gap-2" role="status">
            <p className="text-destructive">
              This edition of the story can't draw {role.member.name}'s {role.unsupported.map((axis) => axisLabels[axis as LookAxis].toLowerCase()).join(" or ")} yet, so the pages
              leave them out. {canEdit && "Pick what this book shows instead:"}
            </p>
            {canEdit &&
              role.unsupported.map((axis) => (
                <NativeSelect
                  key={axis}
                  aria-label={`${label}: ${axisLabels[axis as LookAxis]} in this book`}
                  defaultValue=""
                  onChange={(event) => onOverride({ ...role.override, [axis]: event.target.value })}
                >
                  <option value="" disabled>
                    {axisLabels[axis as LookAxis]}…
                  </option>
                  {supported(axis as LookAxis).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              ))}
          </div>
        ) : (
          // The override applies only while the story can't draw the character's own option (D28); once it can, such
          // as after an addition (D41), the pages draw the character as they are.
          character &&
          (Object.keys(role.override) as Array<LookAxis>).some((axis) => role.member.look[axis] !== character.look[axis]) && (
            <p className="text-muted-foreground text-xs">This book draws a stand-in for options the story can't draw yet.</p>
          )
        )}
      </div>
    </div>
  );
}
