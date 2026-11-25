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

/**
 * Gives a book a stored character sheet per role, as the photo steps leave one (an SVG naming the role, 3:2 like a
 * real sheet), and the six expressions for the roles in `withExpressions` (sheets drawn before them have none).
 * Returns each role's sheet key, and each expressions key under `<slotId>:expressions`.
 */
export const giveSheets = async (
  bookId: string,
  slotIds: ReadonlyArray<string>,
  withExpressions: ReadonlyArray<string> = [],
) => {
  const { Database, ObjectStorage, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const { pool } = yield* Database;
        const storage = yield* ObjectStorage;
        const [{ family_id }] = yield* Effect.promise(() =>
          pool.query("select family_id from book where id = $1", [bookId]).then((result) => result.rows),
        );
        const keys: Record<string, string> = {};
        for (const slotId of slotIds) {
          const key = `families/${family_id}/books/${bookId}/likeness/${slotId}/sheet-e2e.svg`;
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#f4e8d0"/><text x="768" y="540" font-size="120" text-anchor="middle">${slotId} sheet</text></svg>`;
          yield* storage.put(key, new TextEncoder().encode(svg), "image/svg+xml");
          const expressionsKey = withExpressions.includes(slotId)
            ? `families/${family_id}/books/${bookId}/likeness/${slotId}/expressions-e2e.svg`
            : null;
          if (expressionsKey) {
            const faces = `<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="#d0e4f4"/><text x="768" y="540" font-size="120" text-anchor="middle">${slotId} expressions</text></svg>`;
            yield* storage.put(expressionsKey, new TextEncoder().encode(faces), "image/svg+xml");
            keys[`${slotId}:expressions`] = expressionsKey;
          }
          yield* Effect.promise(() =>
            pool.query(
              `insert into book_likeness (book_id, slot_id, sheet_key, expressions_key) values ($1, $2, $3, $4)
               on conflict (book_id, slot_id)
               do update set sheet_key = excluded.sheet_key, expressions_key = excluded.expressions_key`,
              [bookId, slotId, key, expressionsKey],
            ),
          );
          keys[slotId] = key;
        }
        return keys;
      }) as Effect.Effect<Record<string, string>, never, ServerServices>,
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
