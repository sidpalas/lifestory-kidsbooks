import {
  curatedLooks,
  type Look,
  Look as LookSchema,
  type LookAxis,
  lookVocabulary,
  NotAuthenticated,
  NotFound,
  resolvePageText,
  storyAssetKey,
  UnsupportedLook,
  unwrapResult,
} from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { useCallback, useRef, useState } from "react";
import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { ProofPanel } from "~/components/book/ProofPanel";
import { NativeSelect } from "~/components/ui/native-select";
import { MakeBook } from "~/components/make-book";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";
import {
  getStoryPreviewFn,
  listStoryProofsFn,
  RequestProofResult,
  requestStoryProofFn,
  StoryPreviewResult,
  StoryProofsResult,
} from "~/server/functions";

// Looks for the preview, per slot, kept in the URL so a preview with a chosen look can be shared and reloaded.
const PreviewSearch = Schema.Struct({ looks: Schema.optional(Schema.Record(Schema.String, LookSchema)) });

// A story's pages as the author made them, each character slot filled by the slot's example character, or by a
// look picked here. Families see their own cast once they personalize the book.
export const Route = createFileRoute("/stories/$slug")({
  validateSearch: Schema.toStandardSchemaV1(PreviewSearch),
  loaderDeps: ({ search }) => ({ looks: search.looks }),
  loader: async ({ params, deps }) => {
    try {
      const [preview, library] = await Promise.all([getStoryPreviewFn({ data: { slug: params.slug, looks: deps.looks } }), getFamilyLibrary()]);
      return { ...unwrapResult(StoryPreviewResult)(preview), library: unwrapResult(FamilyLibraryResult)(library) };
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  component: StoryPreview,
});

const axisLabels: Record<LookAxis, string> = { age: "Age", face: "Face", features: "Features", skin: "Skin", hair: "Hair", hairColour: "Hair colour", glasses: "Glasses", facialHair: "Facial hair" };

function StoryPreview() {
  const { story, version, manifest, cast, pages, library } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const router = useRouter();
  const [guides, setGuides] = useState(false);
  // A click before React hydrates would be lost, so the controls wait for it.
  const hydrated = useHydrated();
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const { widthIn, heightIn } = manifest.trim;

  // The picker's own record of the chosen looks. The loader data and the router's resolved search both lag behind
  // while pages recompose, so each change builds on this instead and a change made during a load isn't lost.
  const search = Route.useSearch();
  // The state renders the controls; the ref lets changes arriving faster than renders build on each other.
  const [chosen, setChosen] = useState<Record<string, Look>>(search.looks ?? {});
  const latest = useRef(chosen);
  const lookOf = (slotId: string): Look => chosen[slotId] ?? cast[slotId]!.look;
  const setLook = (slotId: string, change: Partial<Look>) => {
    const current = (id: string) => latest.current[id] ?? cast[id]!.look;
    const looks = Object.fromEntries(Object.keys(cast).map((id) => [id, current(id)]));
    latest.current = { ...looks, [slotId]: { ...current(slotId), ...change } };
    setChosen(latest.current);
    // Only the search changes: keep the reader where they are on the page.
    void router.navigate({ to: "/stories/$slug", params: { slug }, search: { looks: latest.current }, replace: true, resetScroll: false });
  };

  const loadProofs = useCallback(async () => unwrapResult(StoryProofsResult)(await listStoryProofsFn({ data: { slug } })), [slug]);
  const requestProof = async () => {
    const looks = Object.fromEntries(Object.keys(cast).map((slotId) => [slotId, lookOf(slotId)]));
    try {
      unwrapResult(RequestProofResult)(await requestStoryProofFn({ data: { slug, looks } }));
    } catch (cause) {
      throw new Error(cause instanceof UnsupportedLook ? "This story can't draw one of the chosen looks." : "The proof couldn't be started.", { cause });
    }
  };

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← All stories
        </Link>
        <h1 className="text-2xl font-semibold">{story.title}</h1>
        <p className="text-muted-foreground text-sm" data-testid="story-meta">
          by {story.authorName} · version {version} · {widthIn} × {heightIn} in · {manifest.pages.length} pages
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={guides} disabled={!hydrated} onChange={(event) => setGuides(event.target.checked)} />
          Show trim, safe area, and figure boxes
        </label>
      </header>

      {library.canEdit && <MakeBook slug={slug} manifest={manifest} characters={library.characters} />}

      <section className="grid gap-4 md:grid-cols-2" aria-label="Characters">
        {manifest.characterSlots.map((slot) => {
          const member = cast[slot.slotId]!;
          const options = (axis: LookAxis) =>
            axis === "age" ? lookVocabulary.age.filter((option) => slot.ages.includes(option.id)) : lookVocabulary[axis];
          return (
            <fieldset key={slot.slotId} className="flex flex-col gap-2 rounded-md border p-3" data-testid={`look-${slot.slotId}`}>
              <legend className="px-1 text-sm font-medium">
                {member.name} as {slot.label.toLowerCase()}
              </legend>
              <div className="flex flex-wrap gap-2">
                {curatedLooks
                  .filter((curated) => slot.ages.includes(curated.look.age))
                  .map((curated) => (
                    <button
                      key={curated.id}
                      type="button"
                      disabled={!hydrated}
                      onClick={() => setLook(slot.slotId, curated.look)}
                      className="rounded-full border px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
                    >
                      {curated.label}
                    </button>
                  ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(axisLabels) as Array<LookAxis>).map((axis) => (
                  <label key={axis} className="flex flex-col gap-1 text-xs">
                    {axisLabels[axis]}
                    <NativeSelect
                      aria-label={`${slot.label}: ${axisLabels[axis]}`}
                      value={lookOf(slot.slotId)[axis]}
                      disabled={!hydrated}
                      onChange={(event) => setLook(slot.slotId, { [axis]: event.target.value } as Partial<Look>)}
                    >
                      {options(axis).map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </section>

      <ProofPanel load={loadProofs} request={requestProof} hydrated={hydrated} />

      <ol className="grid gap-8 md:grid-cols-2">
        {manifest.pages.map((page, i) => (
          <li key={page.pageId} className="flex flex-col gap-2">
            <div className="w-fit rounded-sm shadow-md ring-1 ring-black/10">
              <ScaledPage trim={manifest.trim} scale={0.5}>
                <BookPage
                  manifest={manifest}
                  page={page}
                  text={resolvePageText(page, cast)}
                  illustration={pages[i]!.layers.map((layer) => ({ url: `/api/files/${layer.key}`, rect: layer.rect }))}
                  cast={cast}
                  guides={guides}
                />
              </ScaledPage>
            </div>
            <p className="text-muted-foreground text-xs">Page {i + 1}</p>
          </li>
        ))}
      </ol>
    </main>
  );
}
