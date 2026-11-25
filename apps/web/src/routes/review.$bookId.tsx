// The operator's review of one family book (D57): the approved sheets, every page as chosen with the parent's notes,
// the approved proof, and the photos only when the parent opted in. Redo a page with its own note, refuse with a note
// emailed to the family, or approve for print. Everything is read through reviewBook, which checks the operator role.
// On a phone the summary comes first, then the characters and pages, then the decision; from `lg` the summary and the
// decision sit in a column beside the pages, the decision kept in view while scrolling.
import {
  type BookFlow,
  type BookStatus,
  Forbidden,
  NotAuthenticated,
  NotFound,
  type StoryManifest,
  storyAssetKey,
  unwrapResult,
} from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { flowBusy, usePollWhileBusy } from "~/components/book/photo-book";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
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
/** A figure clipped by more than this share is flagged (figureRules.flagClippedShare). */
const FLAG_CLIPPED = 0.05;

/** Runs one review action, then reloads; returns whether it worked. */
function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const run = async (call: () => Promise<unknown>) => {
    setError(null);
    setPending(true);
    try {
      unwrapResult(FlowStepResult)((await call()) as never);
      await router.invalidate();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { error, pending, run };
}

function Alert({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  ) : null;
}

/** An image that fits its cell, linked to its full size. */
function Shown({ src, alt, testId, className }: { src: string; alt: string; testId?: string; className?: string }) {
  return (
    <a href={src} target="_blank" rel="noreferrer" className={cn("group flex min-w-0 flex-col gap-1", className)}>
      <img
        src={src}
        alt={alt}
        className="h-auto w-full rounded bg-white object-contain ring-1 ring-black/10 group-hover:ring-black/40"
        data-testid={testId}
      />
      <span className="text-xs text-muted-foreground underline-offset-2 group-hover:underline">Open full size</span>
    </a>
  );
}

function Review() {
  const review = Route.useLoaderData();
  const { flow, manifest } = review;
  usePollWhileBusy(flowBusy(flow));
  const bookId = Route.useParams().bookId;
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(review.storyId, review.version, asset)}`;
  const inReview = flow.status === "in_review";
  const drawn = manifest.pages.flatMap((page, index) => {
    const state = flow.pages.find((candidate) => candidate.pageId === page.pageId);
    return state ? [{ page, index, state }] : [];
  });
  const redrawing = drawn.filter(({ state }) => !state.ready);
  const changed = drawn.filter(({ state }) => state.changeNote);
  const clipped = drawn.filter(({ state }) =>
    state.versions.some((v) => v.version === state.chosenVersion && v.clippedShare > FLAG_CLIPPED),
  );

  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-6 p-4 sm:p-8">
      <StoryFonts fonts={manifest.fonts} assetUrl={assetUrl} />
      <header className="flex min-w-0 flex-col gap-1">
        <Link to="/admin" className="text-sm text-muted-foreground hover:underline">
          ← Admin
        </Link>
        <h1 className="text-2xl font-semibold break-words">Review: {review.title}</h1>
        <p className="text-sm text-muted-foreground" data-testid="review-status">
          Status: {flow.status.replace("_", " ")}
          {flow.photoReview ? " · the parent shared the photos for this review" : " · photos not shared"}
          {review.familyName && ` · ${review.familyName}`}
        </p>
      </header>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <section
          aria-label="Summary"
          className="flex min-w-0 flex-col gap-3 rounded-md border bg-muted/40 p-4 text-sm lg:col-start-2 lg:row-start-1 lg:self-start"
          data-testid="review-summary"
        >
          <h2 className="text-base font-semibold">Before you decide</h2>
          <ul className="flex flex-col gap-1">
            <li>
              {drawn.length} drawn {drawn.length === 1 ? "page" : "pages"}
              {changed.length > 0 && ` · notes on page ${changed.map(({ index }) => index + 1).join(", ")}`}
            </li>
            {clipped.length > 0 && (
              <li className="text-amber-700">
                Figures clipped on page {clipped.map(({ index }) => index + 1).join(", ")}: check them.
              </li>
            )}
            {redrawing.length > 0 && (
              <li data-testid="review-redrawing">
                Redrawing page {redrawing.map(({ index }) => index + 1).join(", ")}: about 20 seconds.
              </li>
            )}
          </ul>
          <div className="flex flex-col gap-1" data-testid="review-proof">
            <p className="font-medium">The parent's approved proof</p>
            {review.proofKey ? (
              <>
                <a href={fileUrl(review.proofKey)} className="w-fit underline">
                  Download the approved proof
                </a>
                {review.proofCurrent ? (
                  <p className="text-muted-foreground">It shows the pages as they are now.</p>
                ) : (
                  <p className="text-amber-700" data-testid="review-proof-outdated">
                    Out of date: pages were redrawn after the parent approved it, so the PDF doesn't show them.
                  </p>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">None approved.</p>
            )}
          </div>
          <a href="#review-decision" className="w-fit underline lg:hidden">
            Go to the decision ↓
          </a>
        </section>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <section aria-labelledby="review-characters" className="flex min-w-0 flex-col gap-3">
            <h2 id="review-characters" className="text-lg font-semibold">
              Characters
            </h2>
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {manifest.characterSlots.map((slot) => {
                const likeness = flow.likenesses.find((candidate) => candidate.slotId === slot.slotId)!;
                return (
                  <figure
                    key={slot.slotId}
                    className="flex min-w-0 flex-col gap-2 rounded-md border p-3 text-sm"
                    data-testid={`review-character-${slot.slotId}`}
                  >
                    <figcaption className="font-medium">{slot.label}</figcaption>
                    {/* The photo beside the sheet when there's room, above it on a phone; the six faces under both. */}
                    <div
                      className={cn(
                        "grid min-w-0 gap-2",
                        likeness.photoKey && "min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]",
                      )}
                    >
                      {likeness.photoKey && (
                        <Shown
                          src={fileUrl(likeness.photoKey)}
                          alt={`${slot.label}'s photo`}
                          testId={`review-photo-${slot.slotId}`}
                          className="max-w-40 min-[480px]:max-w-none"
                        />
                      )}
                      {likeness.sheetKey && <Shown src={fileUrl(likeness.sheetKey)} alt={`${slot.label}'s sheet`} />}
                      {likeness.expressionsKey && (
                        <Shown
                          src={fileUrl(likeness.expressionsKey)}
                          alt={`${slot.label}'s expressions`}
                          className="col-span-full"
                        />
                      )}
                    </div>
                    {likeness.notes.map((n) => (
                      <p key={n.round} className="text-xs text-muted-foreground">
                        Parent's note for drawing {n.round}: "{n.note}"
                      </p>
                    ))}
                  </figure>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="review-pages" className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 id="review-pages" className="text-lg font-semibold">
                Pages
              </h2>
              <p className="text-sm text-muted-foreground">
                The drawings as the parent chose them; the text is in the proof. Redo a page with a note to draw it
                again: the new drawing replaces it.
              </p>
            </div>
            <ul aria-label="Pages" className="grid min-w-0 gap-4 min-[480px]:grid-cols-2 xl:grid-cols-3">
              {manifest.pages.map((page, index) => (
                <ReviewPage
                  key={page.pageId}
                  flow={flow}
                  manifest={manifest}
                  bookId={bookId}
                  index={index}
                  inReview={inReview}
                />
              ))}
            </ul>
          </section>
        </div>

        <Decision
          bookId={bookId}
          status={flow.status}
          reviewNote={flow.reviewNote}
          redrawing={redrawing.map(({ index }) => index + 1)}
        />
      </div>
    </main>
  );
}

function ReviewPage({
  flow,
  manifest,
  bookId,
  index,
  inReview,
}: {
  flow: BookFlow;
  manifest: StoryManifest;
  bookId: string;
  index: number;
  inReview: boolean;
}) {
  const page = manifest.pages[index]!;
  const drawn = flow.pages.find((candidate) => candidate.pageId === page.pageId);
  const version = drawn?.versions.find((v) => v.version === drawn.chosenVersion);
  const [redoing, setRedoing] = useState(false);
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  return (
    <li
      className="flex min-w-0 flex-col gap-1.5 rounded-md border p-2 text-xs"
      data-testid={`review-page-${page.pageId}`}
    >
      <span className="w-fit max-w-full rounded-sm ring-1 ring-black/10">
        <ScaledPage trim={manifest.trim} scale={0.4}>
          <BookPage
            manifest={manifest}
            page={page}
            text={[]}
            illustration={(version?.layers ?? []).map((layer) => ({ url: fileUrl(layer.key), rect: layer.rect }))}
            cast={{}}
          />
        </ScaledPage>
      </span>
      <p>
        <span className="font-medium">Page {index + 1}</span>
        {drawn && ` · version ${drawn.chosenVersion} of ${drawn.latestVersion}`}
        {drawn && !drawn.ready && <span className="font-medium"> · redrawing…</span>}
        {version && version.clippedShare > FLAG_CLIPPED && (
          <span className="text-amber-700"> · {Math.round(version.clippedShare * 100)}% clipped</span>
        )}
      </p>
      {drawn?.changeNote && <p className="text-muted-foreground">Note: "{drawn.changeNote}"</p>}
      {drawn &&
        inReview &&
        (redoing ? (
          <form
            className="flex flex-col gap-1.5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await run(() => redoPageFn({ data: { bookId, pageId: page.pageId, note } }))) {
                setRedoing(false);
                setNote("");
              }
            }}
          >
            <textarea
              aria-label={`What to change on page ${index + 1}`}
              placeholder="What to change, for the drawing"
              className="min-h-16 rounded-md border bg-transparent p-2 text-sm"
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={pending || note.trim() === ""}>
                Redraw page {index + 1}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setRedoing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={!drawn.ready}
            onClick={() => setRedoing(true)}
          >
            Redo this page
          </Button>
        ))}
      <Alert text={error} />
    </li>
  );
}

function Decision({
  bookId,
  status,
  reviewNote,
  redrawing,
}: {
  bookId: string;
  status: BookStatus;
  reviewNote: string | null;
  /** Page numbers still being redrawn. */
  redrawing: ReadonlyArray<number>;
}) {
  const [note, setNote] = useState("");
  const { error, pending, run } = useAction();
  const box =
    "flex min-w-0 flex-col gap-2 rounded-md border p-4 text-sm lg:sticky lg:top-4 lg:col-start-2 lg:row-start-2 lg:self-start";
  if (status === "approved")
    return (
      <section id="review-decision" aria-label="Decision" className={box} data-testid="review-decision">
        <h2 className="text-base font-semibold text-emerald-700">✓ Approved for print</h2>
        {reviewNote && <p className="text-muted-foreground">Note: "{reviewNote}"</p>}
      </section>
    );
  if (status === "refused")
    return (
      <section id="review-decision" aria-label="Decision" className={box} data-testid="review-decision">
        <h2 className="text-base font-semibold text-destructive">Refused</h2>
        <p>Emailed to the family: "{reviewNote}"</p>
      </section>
    );
  if (status !== "in_review")
    return (
      <section id="review-decision" aria-label="Decision" className={box} data-testid="review-decision">
        <p className="text-muted-foreground">The family hasn't sent this book for review.</p>
      </section>
    );
  return (
    <section id="review-decision" aria-label="Decision" className={box} data-testid="review-decision">
      <h2 className="text-base font-semibold">Your decision</h2>
      {redrawing.length > 0 ? (
        <p data-testid="review-wait">Approve once page {redrawing.join(", ")} is redrawn and you've checked it.</p>
      ) : (
        <p className="text-muted-foreground">
          Approve it for print, or refuse it with a note the family gets by email.
        </p>
      )}
      <Button
        className="w-fit"
        disabled={pending || redrawing.length > 0}
        onClick={() => run(() => decideBookFn({ data: { bookId, decision: "approve", note: "" } }))}
      >
        Approve for print
      </Button>
      <label className="mt-2 flex flex-col gap-1">
        <span>Or refuse: why, for the family (emailed)</span>
        <textarea
          aria-label="Refusal note"
          className="min-h-16 rounded-md border bg-transparent p-2"
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <Button
        variant="outline"
        className="w-fit"
        disabled={pending || note.trim() === ""}
        onClick={() => run(() => decideBookFn({ data: { bookId, decision: "refuse", note } }))}
      >
        Refuse with this note
      </Button>
      <Alert text={error} />
    </section>
  );
}
