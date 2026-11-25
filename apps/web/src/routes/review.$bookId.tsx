// The operator's review of one family book (D57): the approved sheets, every page as chosen with the parent's notes,
// the proof the parent approved, and the photos only when the parent opted in. The operator only decides: approve
// for print, or refuse with a reason on the book, on pages, or both, emailed to the family (Sid, 2026-11-25); they
// never change the book. Everything is read through reviewBook, which checks the operator role.
// On a phone the summary comes first, then the characters and pages, then the decision; from `lg` the summary and the
// decision sit in a column beside the pages, the decision kept in view while scrolling.
import {
  type BookStatus,
  Forbidden,
  NotAuthenticated,
  NotFound,
  storyAssetKey,
  unwrapResult,
} from "@lifestory/core/contracts";
import { createFileRoute, Link, notFound, redirect, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { BookPage, ScaledPage, StoryFonts } from "~/components/book/BookPage";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { decideBookFn, FlowStepResult, ReviewBookResult, reviewBookFn } from "~/server/photo-books";

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
  const router = useRouter();
  const bookId = Route.useParams().bookId;
  const assetUrl = (asset: string) => `/api/files/${storyAssetKey(review.storyId, review.version, asset)}`;
  const inReview = flow.status === "in_review";
  // The operator's reason per page, for a refusal; sent with the decision.
  const [pageNotes, setPageNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const drawn = manifest.pages.flatMap((page, index) => {
    const state = flow.pages.find((candidate) => candidate.pageId === page.pageId);
    return state ? [{ page, index, state }] : [];
  });
  const changed = drawn.filter(({ state }) => state.changeNote);
  const clipped = drawn.filter(({ state }) =>
    state.versions.some((v) => v.version === state.chosenVersion && v.clippedShare > FLAG_CLIPPED),
  );
  const rewrittenPages = review.pages.flatMap((page, index) =>
    page.text.some((block) => block.original !== null) ? [index + 1] : [],
  );
  const notedPages = manifest.pages.flatMap((page, index) =>
    pageNotes[page.pageId]?.trim()
      ? [{ pageId: page.pageId, number: index + 1, note: pageNotes[page.pageId]!.trim() }]
      : [],
  );
  const decide = async (decision: "approve" | "refuse") => {
    setError(null);
    setPending(true);
    try {
      unwrapResult(FlowStepResult)(
        await decideBookFn({
          data: {
            bookId,
            decision,
            note: decision === "refuse" ? note : "",
            ...(decision === "refuse"
              ? { pageNotes: notedPages.map((page) => ({ pageId: page.pageId, note: page.note })) }
              : {}),
          },
        }),
      );
      await router.invalidate();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

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
              {changed.length > 0 && ` · the parent changed page ${changed.map(({ index }) => index + 1).join(", ")}`}
            </li>
            {rewrittenPages.length > 0 && (
              <li className="text-amber-700" data-testid="review-rewritten">
                The parent rewrote the text on page {rewrittenPages.join(", ")}: check it's fit to print.
              </li>
            )}
            {clipped.length > 0 && (
              <li className="text-amber-700">
                Figures clipped on page {clipped.map(({ index }) => index + 1).join(", ")}: check them.
              </li>
            )}
          </ul>
          <div className="flex flex-col gap-1" data-testid="review-proof">
            <p className="font-medium">The proof the parent approved</p>
            {review.proofKey ? (
              <>
                <a href={fileUrl(review.proofKey)} className="w-fit underline">
                  Download the approved proof
                </a>
                {review.proofCurrent ? (
                  <p className="text-muted-foreground">It shows the book as it was sent: this is the file we print.</p>
                ) : (
                  <p className="text-amber-700" data-testid="review-proof-outdated">
                    Out of date: the book changed after the parent approved it.
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
                Each page as the approved proof prints it, with the family's names and text.
                {inReview && " If a page is why you refuse the book, say what's wrong under it: the family sees it."}
              </p>
            </div>
            <ul aria-label="Pages" className="grid min-w-0 gap-4 md:grid-cols-2">
              {manifest.pages.map((page, index) => {
                const state = flow.pages.find((candidate) => candidate.pageId === page.pageId);
                const version = state?.versions.find((v) => v.version === state.chosenVersion);
                const shown = review.pages.find((candidate) => candidate.pageId === page.pageId)!;
                const rewritten = shown.text.filter((block) => block.original !== null);
                return (
                  <li
                    key={page.pageId}
                    className="flex min-w-0 flex-col gap-1.5 rounded-md border p-2 text-xs"
                    data-testid={`review-page-${page.pageId}`}
                  >
                    {/* The page as it prints: the approved proof's drawing and the family's final text. */}
                    <span className="w-fit max-w-full rounded-sm ring-1 ring-black/10">
                      <ScaledPage trim={manifest.trim} scale={0.6}>
                        <BookPage
                          manifest={manifest}
                          page={page}
                          text={shown.text.map((block) => ({ style: block.style, text: block.text }))}
                          illustration={shown.layers.map((layer) => ({ url: fileUrl(layer.key), rect: layer.rect }))}
                          cast={review.cast}
                        />
                      </ScaledPage>
                    </span>
                    <p>
                      <span className="font-medium">Page {index + 1}</span>
                      {state &&
                        state.latestVersion > 1 &&
                        (state.chosenVersion === 1 ? " · original kept" : " · changed")}
                      {version && version.clippedShare > FLAG_CLIPPED && (
                        <span className="text-amber-700"> · {Math.round(version.clippedShare * 100)}% clipped</span>
                      )}
                    </p>
                    {state?.changeNote && <p className="text-muted-foreground">Parent asked: "{state.changeNote}"</p>}
                    {rewritten.length > 0 && (
                      <div
                        className="flex flex-col gap-1 rounded border-l-2 border-amber-500 bg-amber-50 p-2"
                        data-testid={`review-text-edits-${page.pageId}`}
                      >
                        <p className="font-medium text-amber-900">The parent rewrote the text here</p>
                        {rewritten.map((block, i) => (
                          <div key={i} className="flex flex-col gap-0.5">
                            <p>Now: "{block.text}"</p>
                            <p className="text-muted-foreground">The story's: "{block.original}"</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {inReview ? (
                      <textarea
                        aria-label={`What's wrong with page ${index + 1}`}
                        placeholder="Only if refusing: what's wrong here"
                        className="min-h-12 rounded-md border bg-transparent p-2 text-sm"
                        value={pageNotes[page.pageId] ?? ""}
                        maxLength={1000}
                        onChange={(event) => setPageNotes({ ...pageNotes, [page.pageId]: event.target.value })}
                      />
                    ) : (
                      state?.reviewNote && (
                        <p className="text-destructive" data-testid={`review-page-note-${page.pageId}`}>
                          Refused: "{state.reviewNote}"
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <Decision
          status={flow.status}
          reviewNote={flow.reviewNote}
          note={note}
          setNote={setNote}
          notedPages={notedPages.map(({ number }) => number)}
          pending={pending}
          error={error}
          decide={decide}
        />
      </div>
    </main>
  );
}

function Decision({
  status,
  reviewNote,
  note,
  setNote,
  notedPages,
  pending,
  error,
  decide,
}: {
  status: BookStatus;
  reviewNote: string | null;
  note: string;
  setNote: (note: string) => void;
  /** Numbers of the pages with a reason written under them. */
  notedPages: ReadonlyArray<number>;
  pending: boolean;
  error: string | null;
  decide: (decision: "approve" | "refuse") => Promise<void>;
}) {
  const box =
    "flex min-w-0 scroll-mt-4 flex-col gap-2 rounded-md border p-4 text-sm lg:sticky lg:top-4 lg:col-start-2 lg:row-start-2 lg:self-start";
  const section = (children: React.ReactNode) => (
    <section id="review-decision" aria-label="Decision" className={box} data-testid="review-decision">
      {children}
    </section>
  );
  if (status === "approved")
    return section(<h2 className="text-base font-semibold text-emerald-700">✓ Approved for print</h2>);
  if (status === "refused")
    return section(
      <>
        <h2 className="text-base font-semibold text-destructive">Refused</h2>
        {reviewNote && <p>Emailed to the family: "{reviewNote}"</p>}
        <p className="text-muted-foreground">Any notes on pages show under them.</p>
      </>,
    );
  if (status !== "in_review")
    return section(<p className="text-muted-foreground">The family hasn't sent this book for review.</p>);
  const reasons = note.trim() !== "" || notedPages.length > 0;
  return section(
    <>
      <h2 className="text-base font-semibold">Your decision</h2>
      <p className="text-muted-foreground">
        Approve it for print as the parent's proof shows it, or refuse it with a reason the family gets by email.
      </p>
      <Button className="w-fit" disabled={pending || notedPages.length > 0} onClick={() => void decide("approve")}>
        Approve for print
      </Button>
      {notedPages.length > 0 && (
        <p className="text-xs text-muted-foreground">You wrote what's wrong on a page, so this is a refusal.</p>
      )}
      <label className="mt-2 flex flex-col gap-1">
        <span>Or refuse: what's wrong with the book as a whole (emailed)</span>
        <textarea
          aria-label="Refusal note"
          className="min-h-16 rounded-md border bg-transparent p-2"
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {notedPages.length > 0 && (
        <p data-testid="review-noted-pages">With your notes on page {notedPages.join(", ")}.</p>
      )}
      <Button variant="outline" className="w-fit" disabled={pending || !reasons} onClick={() => void decide("refuse")}>
        Refuse the book
      </Button>
      <Alert text={error} />
    </>,
  );
}
