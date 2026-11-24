// The active family's books and the stories it can make books of: the lists on Home and on the
// Stories and Our books pages of the app shell (D48).
import { type BookSummary, type StorySummary, unwrapResult } from "@lifestory/core/contracts";
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
        <li key={book.id} className="flex items-center justify-between gap-3 rounded-md border bg-card p-3">
          <div className="min-w-0">
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
  stories: ReadonlyArray<StorySummary>;
  books: ReadonlyArray<BookSummary>;
  canEdit: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" data-testid="stories">
      {stories.map((story) => {
        const ours = books.filter((book) => book.storySlug === story.slug);
        return (
          <li key={story.id} className="flex flex-col gap-2 rounded-md border bg-card p-4">
            <Link to="/stories/$slug" params={{ slug: story.slug }} className="font-semibold hover:underline">
              {story.title}
            </Link>
            <p className="text-sm text-muted-foreground">{story.summary}</p>
            <p className="text-xs text-muted-foreground">by {story.authorName}</p>
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
          </li>
        );
      })}
    </ul>
  );
}
