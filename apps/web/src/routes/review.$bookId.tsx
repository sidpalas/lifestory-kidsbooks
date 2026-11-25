// The operator's review of one family book (D57): the approved sheets, every page as chosen with the parent's notes,
// the approved proof, and the photos only when the parent opted in. Redo a page, refuse with a note emailed to the
// family, or approve for print. Everything is read through reviewBook, which checks the operator role.
import { Forbidden, NotAuthenticated, NotFound, storyAssetKey, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { flowBusy, usePollWhileBusy } from "~/components/book/photo-book";
import { Button } from "~/components/ui/button";
import { decideBookFn, FlowStepResult, redoPageFn, ReviewBookResult, reviewBookFn } from "~/server/photo-books";

export const Route = createFileRoute("/review/$bookId")({
  ssr: false,
  loader: async ({ params }) => {
    try {
      return unwrapResult(ReviewBookResult)(await reviewBookFn({ data: { bookId: params.bookId } }));
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof Forbidden || error instanceof NotFound) throw notFound();
      throw error;
    }
  },
  component: Review,
});

const fileUrl = (key: string) => `/api/files/${key}`;

function Review() {
  const review = Route.useLoaderData();
  const { flow, manifest } = review;
  const router = useRouter();
  usePollWhileBusy(flowBusy(flow));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    try {
      unwrapResult(FlowStepResult)((await call()) as never);
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const bookId = Route.useParams().bookId;
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(review.storyId, review.version, asset)}`;
  const inReview = flow.status === "in_review";
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex flex-col gap-1">
        <Link to="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold">Review: {review.title}</h1>
        <p className="text-sm text-muted-foreground" data-testid="review-status">
          Status: {flow.status.replace("_", " ")}
          {flow.photoReview ? " · the parent shared the photos for this review" : " · photos not shared"}
        </p>
      </header>

      <section aria-label="Characters" className="grid gap-3 md:grid-cols-2">
        {manifest.characterSlots.map((slot) => {
          const likeness = flow.likenesses.find((candidate) => candidate.slotId === slot.slotId)!;
          return (
            <figure key={slot.slotId} className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <figcaption className="font-medium">{slot.label}</figcaption>
              <div className="flex gap-2">
                {likeness.photoKey && (
                  <img
                    src={fileUrl(likeness.photoKey)}
                    alt={`${slot.label}'s photo`}
                    className="h-40 rounded"
                    data-testid={`review-photo-${slot.slotId}`}
                  />
                )}
                {likeness.sheetKey && (
                  <img src={fileUrl(likeness.sheetKey)} alt={`${slot.label}'s sheet`} className="h-40 rounded" />
                )}
              </div>
              {likeness.notes.map((n) => (
                <p key={n.round} className="text-xs text-muted-foreground">
                  Round {n.round}: "{n.note}"
                </p>
              ))}
            </figure>
          );
        })}
      </section>

      {review.proofKey && (
        <a href={fileUrl(review.proofKey)} className="w-fit text-sm underline">
          Download the approved proof
        </a>
      )}

      <section aria-label="Pages" className="grid gap-4 md:grid-cols-3">
        {manifest.pages.map((page) => {
          const drawn = flow.pages.find((candidate) => candidate.pageId === page.pageId);
          const version = drawn?.versions.find((v) => v.version === drawn.chosenVersion);
          return (
            <div key={page.pageId} className="flex flex-col gap-1 text-xs" data-testid={`review-page-${page.pageId}`}>
              <span className="w-fit rounded-sm ring-1 ring-black/10">
                <ScaledPage trim={manifest.trim} scale={0.3}>
                  <BookPage
                    manifest={manifest}
                    page={page}
                    text={[]}
                    illustration={(version?.layers ?? []).map((layer) => ({
                      url: fileUrl(layer.key),
                      rect: layer.rect,
                    }))}
                    cast={{}}
                  />
                </ScaledPage>
              </span>
              <span>
                {page.pageId}
                {drawn && ` · version ${drawn.chosenVersion} of ${drawn.latestVersion}`}
                {drawn && !drawn.ready && " · redrawing…"}
                {version && version.clippedShare > 0.05 && (
                  <span className="text-amber-700"> · {Math.round(version.clippedShare * 100)}% clipped</span>
                )}
              </span>
              {drawn?.changeNote && <span className="text-muted-foreground">Note: "{drawn.changeNote}"</span>}
              {drawn && inReview && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  onClick={() => run(() => redoPageFn({ data: { bookId, pageId: page.pageId, note } }))}
                >
                  Redo this page
                </Button>
              )}
            </div>
          );
        })}
      </section>

      {inReview && (
        <section aria-label="Decision" className="flex flex-col gap-2 rounded-md border p-4 text-sm">
          <label className="flex flex-col gap-1">
            <span>Note: for a redo, what to change; for a refusal, why (emailed to the family)</span>
            <textarea
              aria-label="Review note"
              className="min-h-16 rounded-md border bg-transparent p-2"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => run(() => decideBookFn({ data: { bookId, decision: "approve", note } }))}>
              Approve for print
            </Button>
            <Button
              variant="outline"
              disabled={note.trim() === ""}
              onClick={() => run(() => decideBookFn({ data: { bookId, decision: "refuse", note } }))}
            >
              Refuse with this note
            </Button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </main>
  );
}
