import { type Look, NotAuthenticated, NotFound, resolvePageText, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useHydrated, useRouter, useRouterState } from "@tanstack/react-router";
import { Schema } from "effect";
import { useRef, useState, useSyncExternalStore } from "react";
import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { LookPicker } from "~/components/look-picker";
import { EXAMPLE, StoryCast } from "~/components/make-book";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getStoryPreviewFn, PreviewChoice, StoryPreviewResult } from "~/server/functions";

// A story's pages with the family in its roles: each role's family member drawn with their saved look, or the
// story's example character with a look being tried. The choice is kept in the URL, so a preview can be shared and
// reloaded. Making the book keeps the cast; proofs belong to the book.
export const Route = createFileRoute("/stories/$slug")({
  validateSearch: Schema.toStandardSchemaV1(PreviewChoice),
  loaderDeps: ({ search }) => ({ cast: search.cast, looks: search.looks }),
  loader: async ({ params, deps }) => {
    try {
      return unwrapResult(StoryPreviewResult)(await getStoryPreviewFn({ data: { slug: params.slug, ...deps } }));
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  component: StoryPreview,
});

type Choice = { cast: Record<string, string>; looks: Record<string, Look> };

// Half size is 420 px wide for an 8.5 in page, wider than a phone; a phone gets 0.4.
const NARROW = "(max-width: 480px)";
const subscribeNarrow = (change: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
};
const usePageScale = () => (useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW).matches, () => false) ? 0.4 : 0.5);

function StoryPreview() {
  const { story, version, manifest, roles, cast, pages, characters, canEdit, books } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const router = useRouter();
  const updating = useRouterState({ select: (state) => state.isLoading });
  const pageScale = usePageScale();
  // A click before React hydrates would be lost, so the controls wait for it.
  const hydrated = useHydrated();
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const { widthIn, heightIn } = manifest.trim;
  const slots = manifest.characterSlots;

  // The page's own record of the choice. The loader data and the router's resolved search both lag behind while
  // pages recompose, so each change builds on this, and a change made during a load isn't lost. The state renders
  // the controls; the ref lets changes arriving faster than renders build on each other.
  const search = Route.useSearch();
  const [choice, setChoice] = useState<Choice>({ cast: { ...search.cast }, looks: { ...search.looks } });
  const latest = useRef(choice);
  const roleOf = (slotId: string) => roles.find((role) => role.slotId === slotId)!;
  const selected = (slotId: string) =>
    choice.looks[slotId] ? EXAMPLE : (choice.cast[slotId] ?? roleOf(slotId).characterId ?? EXAMPLE);
  const update = (change: (current: Choice) => Choice) => {
    latest.current = change(latest.current);
    setChoice(latest.current);
    // Only the search changes: keep the reader where they are on the page.
    const { cast: chosen, looks } = latest.current;
    const next = { cast: Object.keys(chosen).length > 0 ? chosen : undefined, looks: Object.keys(looks).length > 0 ? looks : undefined };
    void router.navigate({ to: "/stories/$slug", params: { slug }, search: next, replace: true, resetScroll: false });
  };
  const onSelect = (slotId: string, value: string) =>
    update(({ cast: chosen, looks }) => {
      const { [slotId]: _, ...otherLooks } = looks;
      if (value !== EXAMPLE) return { cast: { ...chosen, [slotId]: value }, looks: otherLooks };
      const slot = slots.find((candidate) => candidate.slotId === slotId)!;
      return { cast: chosen, looks: { ...looks, [slotId]: slot.example.look } };
    });
  const tryLook = (slotId: string, look: Look) => update((current) => ({ ...current, looks: { ...current.looks, [slotId]: look } }));

  const shown = slots.map((slot) => cast[slot.slotId]!.name).join(" and ");
  const trying = slots.filter((slot) => choice.looks[slot.slotId]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← All stories
        </Link>
        <h1 className="text-2xl font-semibold">{story.title}</h1>
        <p className="text-muted-foreground text-sm" data-testid="story-meta">
          by {story.authorName} · version {version} · {widthIn} × {heightIn} in · {manifest.pages.length} pages
        </p>
      </header>

      <StoryCast
        slug={slug}
        slots={slots}
        roles={roles}
        characters={characters}
        books={books}
        canEdit={canEdit}
        selected={selected}
        trying={(slotId) => choice.looks[slotId] !== undefined}
        onSelect={onSelect}
        updating={updating}
      />

      {trying.map((slot) => {
        const look = choice.looks[slot.slotId]!;
        return (
          <Card key={slot.slotId} data-testid={`try-${slot.slotId}`}>
            <CardHeader>
              <CardTitle>
                <h2>
                  Trying looks on {slot.example.name}, {slot.label.toLowerCase()}
                </h2>
              </CardTitle>
              <CardDescription>
                {slot.example.name} is the story's example character, not someone in your family. Nothing here is saved; to put someone in your book,
                choose them above.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LookPicker look={look} pronouns={slot.example.pronouns} ages={slot.ages} disabled={!hydrated} onChange={(next) => tryLook(slot.slotId, next)} />
            </CardContent>
          </Card>
        );
      })}

      <section aria-label="Pages" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold" data-testid="pages-heading">
            The pages with {shown}
            {updating && <span className="text-muted-foreground ml-2 text-sm font-normal">Updating…</span>}
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-2">
          {manifest.pages.map((page, i) => (
            <li key={page.pageId} className="flex flex-col gap-2">
              <div className="w-fit max-w-full overflow-hidden rounded-sm shadow-md ring-1 ring-black/10">
                <ScaledPage trim={manifest.trim} scale={pageScale}>
                  <BookPage
                    manifest={manifest}
                    page={page}
                    text={resolvePageText(page, cast)}
                    illustration={pages[i]!.layers.map((layer) => ({ url: `/api/files/${layer.key}`, rect: layer.rect }))}
                    cast={cast}
                  />
                </ScaledPage>
              </div>
              <p className="text-muted-foreground text-xs">Page {i + 1}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
