// The active family's books and the stories it can make books of: the lists on Home and on the
// Stories and Our books pages of the app shell (D48).
import { type BookSummary, type CoverThumbnail, type StoryListing, unwrapResult } from "@lifestory/core/contracts";
import { Link, useHydrated, useRouter } from "@tanstack/react-router";

import { Button } from "~/components/ui/button";
import { deleteBookFn, EditBookResult } from "~/server/books";

/** Asks, then deletes a book with its text edits and proofs. Resolves true once it's gone. */
export const confirmDeleteBook = async (book: { id: string; title: string; cast: string }) => {
  const sure = window.confirm(
    `Delete "${book.title}" with ${book.cast}? Its text edits and PDF proofs are deleted too.`,
  );
  if (!sure) return false;
  unwrapResult(EditBookResult)(await deleteBookFn({ data: { bookId: book.id } }));
  return true;
};

/** A cover page's illustration, its layers placed as BookPage places them, at the width of its container. */
function Cover({ cover, testId }: { cover: CoverThumbnail; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="relative w-full overflow-hidden rounded-sm bg-[#fffaf0] shadow-sm ring-1 ring-black/10"
      style={{ aspectRatio: `${cover.widthIn} / ${cover.heightIn}` }}
    >
      {cover.layers.map(({ key, rect: [x0, y0, x1, y1] }, i) => (
        <img
          key={i}
          src={`/api/files/${key}`}
          alt=""
          loading="lazy"
          className="absolute"
          style={{
            left: `${x0 / 10}%`,
            top: `${y0 / 10}%`,
            width: `${(x1 - x0) / 10}%`,
            height: `${(y1 - y0) / 10}%`,
          }}
        />
      ))}
    </div>
  );
}

export function FamilyBooks({ books, canEdit }: { books: ReadonlyArray<BookSummary>; canEdit: boolean }) {
  const router = useRouter();
  const hydrated = useHydrated();
  if (books.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No books yet.{" "}
        {canEdit && (
          <Link to="/stories" className="text-foreground underline underline-offset-4">
            Choose a story
          </Link>
        )}
      </p>
    );
  return (
    <ul className="flex flex-col gap-2" data-testid="books">
      {books.map((book) => (
        <li key={book.id} className="flex items-center gap-3 rounded-md border bg-card p-3">
          {book.cover && (
            // The title link names the book; this one only makes the picture clickable too.
            <Link
              to="/books/$bookId"
              params={{ bookId: book.id }}
              aria-hidden
              tabIndex={-1}
              className="w-16 shrink-0 sm:w-20"
            >
              <Cover cover={book.cover} testId="book-cover" />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <Link to="/books/$bookId" params={{ bookId: book.id }} className="font-medium hover:underline">
              {book.title}
            </Link>
            <p className="text-xs text-muted-foreground">With {book.cast}</p>
          </div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!hydrated}
              aria-label={`Delete ${book.title} with ${book.cast}`}
              onClick={async () => {
                if (await confirmDeleteBook(book)) await router.invalidate();
              }}
            >
              Delete
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Published stories. One the family has a book of opens that book instead of offering another; with several, the
 * story page lists them all, as D47 has it, instead of the card picking one.
 */
export function StoryList({
  stories,
  books,
  canEdit,
}: {
  stories: ReadonlyArray<StoryListing>;
  books: ReadonlyArray<BookSummary>;
  canEdit: boolean;
}) {
  return (
    // Columns by the room the list has, not the window's width (the sidebar takes some of it): a second column only
    // when each card keeps room for its picture beside a readable summary and button.
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-3" data-testid="stories">
      {stories.map((story) => {
        const ours = books.filter((book) => book.storySlug === story.slug);
        return (
          <li key={story.id} className="flex gap-3 rounded-md border bg-card p-3 sm:gap-4 sm:p-4">
            {story.cover && (
              // The title link names the story; this one only makes the picture clickable too.
              <Link
                to="/stories/$slug"
                params={{ slug: story.slug }}
                aria-hidden
                tabIndex={-1}
                className="w-24 shrink-0 self-start sm:w-32"
              >
                <Cover cover={story.cover} testId="story-cover" />
              </Link>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Link to="/stories/$slug" params={{ slug: story.slug }} className="font-semibold hover:underline">
                {story.title}
              </Link>
              <p className="text-sm text-muted-foreground">{story.summary}</p>
              <p className="text-xs text-muted-foreground">by {story.authorName}</p>
              {story.operatorOnly && (
                <p
                  className="self-start rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-900"
                  data-testid="story-operator-only"
                >
                  Operator only: families don't see it
                </p>
              )}
              <div className="mt-auto pt-1">
                {ours.length === 1 ? (
                  <Button asChild size="sm">
                    <Link to="/books/$bookId" params={{ bookId: ours[0]!.id }}>
                      Open our book
                    </Link>
                  </Button>
                ) : ours.length > 1 ? (
                  <Button asChild size="sm">
                    <Link to="/stories/$slug" params={{ slug: story.slug }}>
                      Our {ours.length} books
                    </Link>
                  </Button>
                ) : (
                  <Button asChild size="sm" variant={canEdit ? "default" : "outline"}>
                    <Link to="/stories/$slug" params={{ slug: story.slug }}>
                      {canEdit ? "Make a book" : "Preview"}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
