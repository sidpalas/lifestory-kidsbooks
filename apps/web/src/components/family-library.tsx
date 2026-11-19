// The active family's characters and books, on the home page.
import { type BookSummary, type Character, unwrapResult } from "@lifestory/core/contracts";
import { Link, useRouter } from "@tanstack/react-router";
import { portraitUrl } from "~/components/look-picker";
import { Button } from "~/components/ui/button";
import { deleteBookFn, EditBookResult } from "~/server/books";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

/** Asks, then deletes a book with its text edits and proofs. Resolves true once it's gone. */
export const confirmDeleteBook = async (book: { id: string; title: string; cast: string }) => {
  const sure = window.confirm(
    `Delete "${book.title}" with ${book.cast}? Its text edits and PDF proofs are deleted too. Your family's characters stay.`,
  );
  if (!sure) return false;
  unwrapResult(EditBookResult)(await deleteBookFn({ data: { bookId: book.id } }));
  return true;
};

export function FamilyLibrary({ characters, books, canEdit }: { characters: ReadonlyArray<Character>; books: ReadonlyArray<BookSummary>; canEdit: boolean }) {
  const router = useRouter();
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Characters</CardTitle>
          <CardDescription>Your family as drawn in books. Each story draws these looks with its own illustrations.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-wrap gap-3" data-testid="characters">
            {characters.map((character) => (
              <li key={character.id}>
                <Link
                  to="/characters/$characterId"
                  params={{ characterId: character.id }}
                  className="flex w-24 flex-col items-center gap-1 rounded-md p-1 text-sm hover:bg-accent"
                >
                  <img src={portraitUrl(character.look)} alt="" width={61} height={70} className="rounded-md ring-1 ring-black/10" />
                  <span className="w-full truncate text-center font-medium">{character.name}</span>
                  <span className="text-muted-foreground text-xs">{character.title ? `${character.title} · ${character.pronouns}` : character.pronouns}</span>
                </Link>
              </li>
            ))}
            {canEdit && (
              <li>
                <Link to="/characters/new" className="flex h-[70px] w-24 items-center justify-center rounded-md border border-dashed text-sm hover:bg-accent">
                  Add someone
                </Link>
              </li>
            )}
          </ul>
          {characters.length === 0 && !canEdit && <p className="text-muted-foreground text-sm">No characters yet.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Our books</CardTitle>
          <CardDescription>{canEdit ? "Open a story below and choose who plays each part to make a book." : "The family's personalized books."}</CardDescription>
        </CardHeader>
        <CardContent>
          {books.length === 0 ? (
            <p className="text-muted-foreground text-sm">No books yet.</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="books">
              {books.map((book) => (
                <li key={book.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                  <div className="min-w-0">
                    <Link to="/books/$bookId" params={{ bookId: book.id }} className="font-medium hover:underline">
                      {book.title}
                    </Link>
                    <p className="text-muted-foreground text-xs">With {book.cast}</p>
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
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
          )}
        </CardContent>
      </Card>
    </>
  );
}
