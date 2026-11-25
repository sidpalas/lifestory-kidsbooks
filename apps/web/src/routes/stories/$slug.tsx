import { NotAuthenticated, NotFound, resolvePageText, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { StoryCast } from "~/components/make-book";
import { cn } from "~/lib/utils";
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

/** Page indexes by the book's spreads: the cover alone, then pairs, [[0], [1, 2], [3, 4], …], the last maybe alone. */
const spreads = (count: number) => {
  const rows = [[0]];
  for (let i = 1; i < count; i += 2) rows.push(i + 1 < count ? [i, i + 1] : [i]);
  return rows;
};

function StoryPreview() {
  const { story, archived, version, manifest, cast, pages, people, canEdit, books } = Route.useLoaderData();
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
        people={people}
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
        <p className="text-sm text-muted-foreground" data-testid="placeholder-note">
          <span className="font-medium text-foreground">
            {slots.length === 1 ? `${shown} is a placeholder.` : `${shown} are placeholders.`}
          </span>{" "}
          In your family's book, each part gets the name of the person who plays it and an illustration drawn from their
          photo.
        </p>
        {/* As in the printed book: page 1, the cover, is a right-hand page on its own, and every later left-hand
            (even) page faces the next one, 2–3 … 16–17. On a phone the pages stack, a spread at a time. */}
        <ol className="flex flex-col gap-8">
          {spreads(manifest.pages.length).map((spread) => (
            <li
              key={spread[0]}
              data-testid="spread"
              className={cn(
                "flex flex-col gap-3 md:flex-row md:gap-0",
                spread[0] === 0 ? "md:justify-center" : "md:justify-start",
              )}
            >
              {spread.map((i) => (
                <div
                  key={manifest.pages[i]!.pageId}
                  className={cn(
                    "flex min-w-0 flex-col md:basis-1/2",
                    // Each page of a spread meets the other at the gutter; the cover sits in the middle.
                    i === 0 ? "md:items-center" : i % 2 === 1 ? "md:items-end" : "md:items-start",
                  )}
                >
                  <div className="flex max-w-full flex-col gap-2">
                    <div
                      className={cn(
                        "w-fit max-w-full overflow-hidden rounded-sm shadow-md ring-1 ring-black/10",
                        i > 0 && (i % 2 === 1 ? "md:rounded-r-none" : "md:rounded-l-none"),
                      )}
                    >
                      <ScaledPage trim={manifest.trim} scale={0.5}>
                        <BookPage
                          manifest={manifest}
                          page={manifest.pages[i]!}
                          text={resolvePageText(manifest.pages[i]!, cast)}
                          illustration={pages[i]!.layers.map((layer) => ({
                            url: `/api/files/${layer.key}`,
                            rect: layer.rect,
                          }))}
                          cast={cast}
                        />
                      </ScaledPage>
                    </div>
                    {/* The number at the page's outer edge, as a book prints it. */}
                    <p
                      className={cn(
                        "text-xs text-muted-foreground",
                        i === 0 ? "md:text-center" : i % 2 === 0 && "md:text-right",
                      )}
                    >
                      {i === 0 ? "Cover" : `Page ${i + 1}`}
                    </p>
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
