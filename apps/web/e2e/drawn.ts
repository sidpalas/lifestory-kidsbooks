// Specs about a book's cast, text and proofs start from a drawn book (D57: status `changes`), as one is after the
// order and `book.make`; photo-book.spec.ts covers the steps before it, through the real tasks.
import type { ServerServices } from "@lifestory/core";
import type { Page } from "@playwright/test";
import { Effect } from "effect";

/** Moves books past the photo steps, as if ordered and drawn with the story's stock figures. */
export const markDrawn = async (...bookIds: ReadonlyArray<string>) => {
  const { Database, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  try {
    await runtime.runPromise(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query("update book set status = 'changes', ordered_at = now() where id = any($1)", [bookIds]),
        ),
      ) as Effect.Effect<unknown, never, ServerServices>,
    );
  } finally {
    await runtime.dispose();
  }
};

/** The book the page shows (/books/<id>), marked drawn and reloaded. */
export const markShownBookDrawn = async (page: Page) => {
  await page.waitForURL(/\/books\/book_/);
  const bookId = new URL(page.url()).pathname.split("/").pop()!;
  await markDrawn(bookId);
  await page.reload();
  return bookId;
};
