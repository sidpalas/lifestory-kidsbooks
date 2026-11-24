import { NotAuthenticated, NotFound, resolvePageText, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { StoryCast } from "~/components/make-book";
import { getStoryPreviewFn, StoryPreviewResult } from "~/server/functions";

// A story's pages with the illustrator's own characters (D56), and the family's choice of who plays each role.
// Making the book keeps the cast; the family's people are drawn from their photos.
export const Route = createFileRoute("/stories/$slug")({
  loader: async ({ params }) => {
    try {
      return unwrapResult(StoryPreviewResult)(await getStoryPreviewFn({ data: { slug: params.slug } }));
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  component: StoryPreview,
});

function StoryPreview() {
  const { story, archived, version, manifest, cast, pages, characters, canEdit, books } = Route.useLoaderData();
  const { slug } = Route.useParams();
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const { widthIn, heightIn } = manifest.trim;
  const slots = manifest.characterSlots;
  const shown = slots.map((slot) => cast[slot.slotId]!.name).join(" and ");

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-2">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← All stories
        </Link>
        <h1 className="text-2xl font-semibold">{story.title}</h1>
        <p className="text-sm text-muted-foreground" data-testid="story-meta">
          by {story.authorName} · version {version} · {widthIn} × {heightIn} in · {manifest.pages.length} pages
        </p>
        {archived && (
          <p
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm"
            data-testid="story-archived"
            role="status"
          >
            <span className="font-medium">Archived.</span> Families can't find this story or make new books of it; the
            books they made stay theirs. You see it because you wrote it.{" "}
            <Link to="/author/$storyId" params={{ storyId: story.id }} className="underline">
              Restore it in Studio
            </Link>
          </p>
        )}
      </header>

      <StoryCast
        slug={slug}
        version={version}
        slots={slots}
        characters={characters}
        books={books}
        canEdit={canEdit}
        archived={archived}
      />

      <section aria-label="Pages" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold" data-testid="pages-heading">
            The pages with {shown}
          </h2>
        </div>
        <ol className="grid gap-8 md:grid-cols-2">
          {manifest.pages.map((page, i) => (
            <li key={page.pageId} className="flex flex-col gap-2">
              <div className="w-fit max-w-full overflow-hidden rounded-sm shadow-md ring-1 ring-black/10">
                <ScaledPage trim={manifest.trim} scale={0.5}>
                  <BookPage
                    manifest={manifest}
                    page={page}
                    text={resolvePageText(page, cast)}
                    illustration={pages[i]!.layers.map((layer) => ({
                      url: `/api/files/${layer.key}`,
                      rect: layer.rect,
                    }))}
                    cast={cast}
                  />
                </ScaledPage>
              </div>
              <p className="text-xs text-muted-foreground">Page {i + 1}</p>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
