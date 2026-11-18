import { exampleCast, NotAuthenticated, NotFound, resolvePageText, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { getStoryPreviewFn, StoryPreviewResult } from "~/server/functions";

// A story's pages as the author made them, each character slot filled by the
// slot's example character. Families see their own cast once they personalize it.
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
  const { story, version, manifest } = Route.useLoaderData();
  const [guides, setGuides] = useState(false);
  // A click before React hydrates would be lost, so the toggle waits for it.
  const hydrated = useHydrated();
  const cast = exampleCast(manifest);
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(story.id, version, asset)}`;
  const { widthIn, heightIn } = manifest.trim;

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
        <p className="text-sm">
          Previewed with{" "}
          {manifest.characterSlots.map((slot, i) => (
            <span key={slot.slotId}>
              {i > 0 && (i === manifest.characterSlots.length - 1 ? " and " : ", ")}
              <strong>{slot.example.name}</strong> as {slot.label.toLowerCase()}
            </span>
          ))}
          .
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={guides} disabled={!hydrated} onChange={(event) => setGuides(event.target.checked)} />
          Show trim and safe area
        </label>
      </header>

      <ol className="grid gap-8 md:grid-cols-2">
        {manifest.pages.map((page, i) => (
          <li key={page.pageId} className="flex flex-col gap-2">
            <div className="w-fit rounded-sm shadow-md ring-1 ring-black/10">
              <ScaledPage trim={manifest.trim} scale={0.5}>
                <BookPage
                  manifest={manifest}
                  page={page}
                  text={resolvePageText(page, cast)}
                  cast={cast}
                  assetUrl={assetUrl}
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
