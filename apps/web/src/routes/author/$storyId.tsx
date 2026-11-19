// One story of an author (D37): the draft editor while a version is being drafted, otherwise the published versions
// and a way to start the next one. Server rendering is off, like the book editor: it's interactive only.
import { Forbidden, NotAuthenticated, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { DraftEditor } from "~/components/authoring/draft-editor";
import { message } from "~/components/authoring/fields";
import { Button } from "~/components/ui/button";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";
import { DraftResult, getDraftFn, StartNextVersionResult, startNextVersionFn, StoryVersionsResult, storyVersionsFn } from "~/server/authoring";

export const Route = createFileRoute("/author/$storyId")({
  ssr: false,
  loader: async ({ params }) => {
    try {
      const versions = unwrapResult(StoryVersionsResult)(await storyVersionsFn({ data: { storyId: params.storyId } }));
      const draft = versions.draftVersion === null ? null : unwrapResult(DraftResult)(await getDraftFn({ data: { storyId: params.storyId } }));
      // Family members the author can preview roles as; an author without a family to read just has none.
      const characters = draft ? await getFamilyLibrary().then((r) => unwrapResult(FamilyLibraryResult)(r).characters).catch(() => []) : [];
      return { versions, draft, characters };
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof NotFound || error instanceof Forbidden) throw notFound();
      throw error;
    }
  },
  pendingComponent: () => <p className="p-8 text-sm">Composing pages…</p>,
  component: AuthorStory,
});

function AuthorStory() {
  const { versions, draft, characters } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const latest = versions.published[0];
  const startNext = async () => {
    try {
      unwrapResult(StartNextVersionResult)(await startNextVersionFn({ data: { storyId: versions.story.id } }));
      await router.invalidate();
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 p-6">
      <header className="flex flex-col gap-1">
        <Link to="/author" className="text-muted-foreground text-sm hover:underline">
          ← Your stories
        </Link>
        <h1 className="text-2xl font-semibold" data-testid="authoring-title">
          {versions.story.title}
        </h1>
        <p className="text-muted-foreground text-sm" data-testid="authoring-meta">
          /{versions.story.slug} · {draft ? `drafting version ${draft.version}` : "no draft open"}
          {latest && ` · version ${latest.version} published ${new Date(latest.publishedAt).toLocaleDateString()}`}
        </p>
      </header>
      {draft ? (
        <DraftEditor key={`${draft.story.id}:${draft.version}`} initial={draft} characters={characters} />
      ) : (
        <section className="flex flex-col gap-3" data-testid="published-versions">
          {latest && (
            <p className="text-sm" role="status">
              Version {latest.version} is published and can't change.{" "}
              <Link to="/stories/$slug" params={{ slug: versions.story.slug }} className="font-medium underline">
                Open the story
              </Link>
            </p>
          )}
          <Button className="self-start" variant="outline" onClick={() => void startNext()}>
            Start version {(latest?.version ?? 0) + 1}
          </Button>
          {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
        </section>
      )}
    </main>
  );
}
