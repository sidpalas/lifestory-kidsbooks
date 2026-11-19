// The active family's characters and books, on the home page.
import type { BookSummary, Character } from "@lifestory/core/contracts";
import { Link } from "@tanstack/react-router";
import { portraitUrl } from "~/components/look-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function FamilyLibrary({ characters, books, canEdit }: { characters: ReadonlyArray<Character>; books: ReadonlyArray<BookSummary>; canEdit: boolean }) {
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
                  <span className="text-muted-foreground text-xs">{character.pronouns}</span>
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
                <li key={book.id} className="rounded-md border p-3">
                  <Link to="/books/$bookId" params={{ bookId: book.id }} className="font-medium hover:underline">
                    {book.title}
                  </Link>
                  <p className="text-muted-foreground text-xs">With {book.cast}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
