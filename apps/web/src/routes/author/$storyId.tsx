// One story of an author (D37): the draft editor while a version is being drafted, otherwise the published versions
// and a way to start the next one. Server rendering is off, like the book editor: it's interactive only.
import { Forbidden, NotAuthenticated, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { StudioBar } from "~/components/app-shell";
import { DraftEditor } from "~/components/authoring/draft-editor";
import { message } from "~/components/authoring/fields";
import { Button } from "~/components/ui/button";
import {
  ArchiveStoryResult,
  DraftResult,
  getDraftFn,
  setStoryArchivedFn,
  StartNextVersionResult,
  startNextVersionFn,
  StoryVersionsResult,
  storyVersionsFn,
} from "~/server/authoring";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/author/$storyId")({
  ssr: false,
  loader: async ({ params }) => {
    try {
      const versions = unwrapResult(StoryVersionsResult)(await storyVersionsFn({ data: { storyId: params.storyId } }));
      const draft =
        versions.draftVersion === null
          ? null
          : unwrapResult(DraftResult)(await getDraftFn({ data: { storyId: params.storyId } }));
      // Family members the author can preview roles as; an author without a family to read just has none.
      const characters = draft
        ? await getFamilyLibrary()
            .then((r) => unwrapResult(FamilyLibraryResult)(r).characters)
            .catch(() => [])
        : [];
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
  // Disabled from the click until the editor opens, so a second click can't start another request.
  const [starting, setStarting] = useState(false);
  const latest = versions.published[0];
  const next = (latest?.version ?? 0) + 1;
  const startNext = async () => {
    setStarting(true);
    setError(null);
    try {
      unwrapResult(StartNextVersionResult)(await startNextVersionFn({ data: { storyId: versions.story.id } }));
      await router.invalidate();
    } catch (cause) {
      setError(message(cause));
      setStarting(false);
    }
  };
  return (
    <>
      <StudioBar />
      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 p-6">
        <header className="flex flex-col gap-1">
          <Link to="/author" className="text-sm text-muted-foreground hover:underline">
            ← Your stories
          </Link>
          <h1 className="text-2xl font-semibold" data-testid="authoring-title">
            {versions.story.title}
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="authoring-meta">
            /{versions.story.slug} · {draft ? `drafting version ${draft.version}` : "no draft open"}
            {latest && ` · version ${latest.version} published ${new Date(latest.publishedAt).toLocaleDateString()}`}
          </p>
          {versions.story.status !== "draft" && (
            <Catalogue storyId={versions.story.id} archived={versions.story.status === "archived"} />
          )}
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
            <Button
              className="self-start"
              variant="outline"
              disabled={starting}
              aria-busy={starting}
              onClick={() => void startNext()}
            >
              {starting ? `Starting version ${next}…` : `Start version ${next}`}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
    </>
  );
}

/** Whether families find the story (D49): archiving hides it and stops new books; restoring brings it back. */
function Catalogue({ storyId, archived }: { storyId: string; archived: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = async (archive: boolean) => {
    setBusy(true);
    setError(null);
    try {
      unwrapResult(ArchiveStoryResult)(await setStoryArchivedFn({ data: { storyId, archived: archive } }));
      setConfirming(false);
      await router.invalidate();
    } catch (cause) {
      setError(message(cause));
    }
    setBusy(false);
  };
  return (
    <div
      className={`mt-1 flex flex-col gap-2 rounded-md border p-3 text-sm ${archived ? "border-amber-300 bg-amber-50" : ""}`}
      data-testid="story-catalogue"
      data-archived={archived}
    >
      {archived ? (
        <>
          <p>
            <span className="font-medium">Archived.</span> Families don't see this story and can't make new books of it.
            Books already made, their proofs, and every version stay as they are. Publishing a new version keeps it
            archived.
          </p>
          <Button size="sm" className="self-start" disabled={busy} onClick={() => void set(false)}>
            Restore to families' stories
          </Button>
        </>
      ) : confirming ? (
        <>
          <p>
            <span className="font-medium">Archive this story?</span> It leaves every family's stories and nobody can
            make a new book of it. Families keep the books they made, with their proofs, and you can restore it at any
            time.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void set(true)}>
              Archive the story
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p>In every family's stories.</p>
          <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
            Archive…
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
