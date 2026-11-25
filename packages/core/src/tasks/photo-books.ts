// The durable workflows of a photo book (D56, D57): checking each photo, drawing the character sheets and the cover,
// the change rounds, the order's page drawing, and releasing the photos. Every side effect is a step and every image
// goes through `generateImage`, so a rerun never pays twice; object keys derive from the book, page, slot, version
// and upload, so a rerun overwrites the same objects.
import { schema } from "@lifestory/db";
import type { TaskContext } from "absurd-sdk";
import { and, eq, sql } from "drizzle-orm";
import { Config, Effect, Schema } from "effect";

import { coverPage, type Page, pageFigures, type PhotoFigure, storyAssetKey } from "../book-format/index.ts";
import { loadBook } from "../books.ts";
import { type Hair, PhotoCheckResult, type PhotoReport } from "../contracts.ts";
import { Database } from "../database.ts";
import { GenerationFailed } from "../errors.ts";
import {
  figureAcceptable,
  FigureUnusable,
  fitFigure,
  generationSize,
  illustrationAspect,
  pageReference,
  placeReference,
} from "../figure.ts";
import { generateImage } from "../generations.ts";
import { defineTask, Jobs, step } from "../jobs.ts";
import { judgePhoto, moderationRefusals, PhotoCheck } from "../photo-check.ts";
import { photoPrompts } from "../photo-prompts.ts";
import { ObjectStorage } from "../storage.ts";

/** Everything a book owns in storage (D31): photos, likeness (sheets, cover), and pages. Deleted with the book. */
export const bookPrefix = (familyId: string, bookId: string) => `families/${familyId}/books/${bookId}/`;
export const photoObjectKey = (familyId: string, bookId: string, slotId: string, uploadId: string) =>
  `${bookPrefix(familyId, bookId)}photos/${slotId}/${uploadId}`;

/** Deletes every photo of a book from storage and marks the likenesses; idempotent. */
export const deleteBookPhotos = Effect.fn("photoBooks.deletePhotos")(function* (familyId: string, bookId: string) {
  const storage = yield* ObjectStorage;
  const photos = yield* storage.list(`${bookPrefix(familyId, bookId)}photos/`);
  yield* Effect.forEach(photos, ({ key }) => storage.delete(key), { concurrency: 8, discard: true });
  yield* Database.query((db) =>
    db
      .update(schema.bookLikeness)
      .set({ photoKey: null, photoDeletedAt: sql`coalesce(${schema.bookLikeness.photoDeletedAt}, now())` })
      .where(eq(schema.bookLikeness.bookId, bookId)),
  );
  return photos.length;
});

const likenesses = (bookId: string) =>
  Database.query((db) => db.select().from(schema.bookLikeness).where(eq(schema.bookLikeness.bookId, bookId)));

type LoadedBook = Effect.Success<ReturnType<typeof loadBook>>;

export interface DrawnFigure {
  readonly figure: number;
  readonly slotId: string;
  readonly key: string;
  readonly generationId: string;
  readonly iou: number;
  readonly rescaled: boolean;
  readonly clippedShare: number;
}

const ATTEMPTS = 3;

/**
 * Draws every figure of a page from the book's sheets (D56), back to front, each seeing the others bald: the page
 * reference, the model call on a transparent background, then the checks. An output with no transparency, or one the
 * checks don't accept (too much clipped, or off its window), is drawn again, up to three times. `tag` names the drawing (`v1`, `v2`, `cover-r0`) and keys its generations and objects.
 */
export const drawPageFigures = Effect.fn("photoBooks.drawPageFigures")(function* (
  ctx: TaskContext,
  book: LoadedBook,
  page: Page,
  sheets: Readonly<Record<string, string>>,
  options: { readonly tag: string; readonly outputBase: string; readonly note?: string },
) {
  const { manifest } = book;
  const style = manifest.photo!;
  const asset = (path: string) => storyAssetKey(book.storyId, book.version, path);
  const plate = page.illustration.layers[0];
  const figures = pageFigures(page);
  const aspect = illustrationAspect(manifest.trim, page.art);
  const drawn: Array<DrawnFigure> = [];
  for (const [index, figure] of figures.entries()) {
    const sheet = sheets[figure.slotId];
    if (!sheet) return yield* Effect.die(new Error(`book ${book.id} has no sheet for ${figure.slotId}`));
    const size = generationSize(figure.window, aspect);
    const name = `${page.pageId}:${index}`;
    const referenceKey = `${options.outputBase}/${index}-reference.png`;
    yield* step(
      ctx,
      `${name}:reference`,
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        if (plate?.kind !== "art") return yield* Effect.die(new Error(`page ${page.pageId} has no plate`));
        const plateBody = (yield* storage.get(asset(plate.asset))).body;
        const references = yield* Effect.forEach(
          figures.filter((f): f is PhotoFigure & { reference: string } => f.reference !== undefined),
          (f) => storage.get(asset(f.reference)).pipe(Effect.map(({ body }) => ({ reference: body, box: f.box }))),
        );
        const png = yield* Effect.promise(() => pageReference(plateBody, references, figure.window, size));
        yield* storage.put(referenceKey, png, "image/png");
        return referenceKey;
      }).pipe(Effect.orDie),
    );
    // Each try that comes back usable is kept; one the checks accept ends the tries, else the least clipped wins.
    let result: DrawnFigure | null = null;
    let accepted = false;
    for (let attempt = 0; attempt < ATTEMPTS && !accepted; attempt++) {
      const generated = yield* generateImage(ctx, `${name}:a${attempt}`, {
        key: `figure:${book.id}:${options.tag}:${page.pageId}:${index}:${attempt}`,
        prompt: photoPrompts[style.promptVersion].figure({ style, ...(options.note ? { note: options.note } : {}) }),
        ...size,
        references: [referenceKey, sheet],
        background: "transparent",
        outputKey: `${options.outputBase}/${index}-drawn-${attempt}`,
      });
      const fitted = yield* step(
        ctx,
        `${name}:fit:a${attempt}`,
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const output = (yield* storage.get(generated.key)).body;
          if (!figure.reference) return yield* Effect.die(new Error(`figure ${name} has no reference`));
          const reference = (yield* storage.get(asset(figure.reference))).body;
          const bald = yield* Effect.promise(() => placeReference(reference, figure.box, figure.window, size));
          const checked = yield* Effect.tryPromise({
            try: () =>
              fitFigure({ output, bald, head: figure.head, window: figure.window, size, tint: figure.tint ?? true }),
            catch: (error) => error,
          }).pipe(
            Effect.catchIf(
              (error) => error instanceof FigureUnusable,
              () => Effect.succeed(null),
            ),
            Effect.orDie,
          );
          if (!checked) return null;
          const key = `${options.outputBase}/${index}${attempt === 0 ? "" : `-a${attempt}`}.png`;
          yield* storage.put(key, checked.png, "image/png");
          return {
            drawn: {
              figure: index,
              slotId: figure.slotId,
              key,
              generationId: generated.generationId,
              iou: checked.iou,
              rescaled: checked.rescaled,
              clippedShare: checked.clippedShare,
            },
            acceptable: figureAcceptable(checked),
          };
        }).pipe(Effect.orDie),
      );
      if (!fitted) continue;
      if (!result || fitted.drawn.clippedShare < result.clippedShare) result = fitted.drawn;
      accepted = fitted.acceptable;
    }
    if (!result)
      return yield* new GenerationFailed({
        generationId: `figure:${book.id}:${options.tag}:${page.pageId}:${index}`,
        message: `no usable figure after ${ATTEMPTS} tries`,
      });
    drawn.push(result);
  }
  return drawn;
});

/** Each role's sheet key, read in a step so a rerun sees the sheets the first run started from. */
const sheetsAtStart = (ctx: TaskContext, bookId: string) =>
  step(
    ctx,
    "sheets",
    likenesses(bookId).pipe(
      Effect.map((rows) =>
        Object.fromEntries(rows.flatMap((row) => (row.sheetKey ? [[row.slotId, row.sheetKey] as const] : []))),
      ),
    ),
  );

/** Draws the cover from the current sheets and marks the likeness ready. */
const drawCover = Effect.fn("photoBooks.drawCover")(function* (
  ctx: TaskContext,
  book: LoadedBook,
  sheets: Readonly<Record<string, string>>,
  round: number,
) {
  const page = coverPage(book.manifest);
  const cover = page
    ? yield* drawPageFigures(ctx, book, page, sheets, {
        tag: `cover-r${round}`,
        outputBase: `${bookPrefix(book.familyId, book.id)}likeness/cover/r${round}`,
      })
    : [];
  yield* step(
    ctx,
    "ready",
    Database.query((db) =>
      db
        .update(schema.book)
        .set({ cover: cover.map((figure) => figure.key), likenessStatus: "ready" })
        .where(eq(schema.book.id, book.id)),
    ).pipe(Effect.as(null)),
  );
});

const markLikenessFailed = (ctx: TaskContext, bookId: string) =>
  step(
    ctx,
    "failed",
    Database.query((db) =>
      db.update(schema.book).set({ likenessStatus: "failed" }).where(eq(schema.book.id, bookId)),
    ).pipe(Effect.as(null)),
  );

/** A role's likeness while `uploadId` is still its photo and not deleted, else null. */
const currentUpload = (bookId: string, slotId: string, uploadId: string) =>
  Database.query((db) =>
    db
      .select()
      .from(schema.bookLikeness)
      .where(and(eq(schema.bookLikeness.bookId, bookId), eq(schema.bookLikeness.slotId, slotId))),
  ).pipe(Effect.map(([row]) => (row?.uploadId === uploadId && row.photoKey ? row : null)));

/** The photo of `uploadId` for the check, or null once replaced or deleted. */
const uploadedPhoto = (bookId: string, slotId: string, uploadId: string, fileName: string) =>
  Effect.gen(function* () {
    const row = yield* currentUpload(bookId, slotId, uploadId);
    if (!row) return null;
    const object = yield* (yield* ObjectStorage).get(row.photoKey!).pipe(Effect.orDie);
    return { body: object.body, contentType: object.contentType, fileName };
  });

/**
 * Checks one uploaded photo (D56): moderation with per-category thresholds, then the vision model, then the rules in
 * code. A refused photo is deleted at once. When every role's photo has passed, starts the sheets.
 */
export const checkPhoto = defineTask({
  name: "photo.check",
  params: Schema.Struct({
    bookId: Schema.String,
    slotId: Schema.String,
    uploadId: Schema.String,
    fileName: Schema.String,
  }),
  run: ({ bookId, slotId, uploadId, fileName }, ctx) =>
    Effect.gen(function* () {
      const moderation = yield* step(
        ctx,
        "moderate",
        Effect.gen(function* () {
          const input = yield* uploadedPhoto(bookId, slotId, uploadId, fileName);
          return input ? yield* (yield* PhotoCheck).moderate(input) : null;
        }).pipe(Effect.orDie),
      );
      // Replaced by a newer upload meanwhile: that upload's check decides.
      if (!moderation) return { status: "stale" as const };
      const refusedFirst = moderationRefusals(moderation);

      const report: PhotoReport | null =
        refusedFirst.length > 0
          ? null
          : yield* step(
              ctx,
              "inspect",
              Effect.gen(function* () {
                const input = yield* uploadedPhoto(bookId, slotId, uploadId, fileName);
                if (!input) return null;
                const { usage: _, ...inspection } = yield* (yield* PhotoCheck).inspect(input);
                return { moderation, ...inspection };
              }).pipe(Effect.orDie),
            );

      const status = yield* step(
        ctx,
        "store",
        Effect.gen(function* () {
          const row = yield* currentUpload(bookId, slotId, uploadId);
          if (!row) return "stale" as const;
          const book = yield* loadBook(bookId).pipe(Effect.orDie);
          const slot = book.manifest.characterSlots.find((candidate) => candidate.slotId === slotId);
          const result: PhotoCheckResult = report
            ? judgePhoto(report, { ages: slot?.ages ?? [] }, row.hair as Hair | null)
            : { status: "refused", refusals: refusedFirst, warnings: [], report: null };
          if (result.status === "refused") yield* (yield* ObjectStorage).delete(row.photoKey!).pipe(Effect.orDie);
          yield* Database.query((db) =>
            db
              .update(schema.bookLikeness)
              .set({
                checkStatus: result.status,
                check: Schema.encodeSync(PhotoCheckResult)(result),
                ...(result.status === "refused" ? { photoKey: null, photoDeletedAt: new Date() } : {}),
              })
              .where(
                and(
                  eq(schema.bookLikeness.bookId, bookId),
                  eq(schema.bookLikeness.slotId, slotId),
                  eq(schema.bookLikeness.uploadId, uploadId),
                ),
              ),
          );
          return result.status;
        }),
      );
      if (status !== "passed") return { status };

      yield* step(
        ctx,
        "preview",
        Effect.gen(function* () {
          const book = yield* loadBook(bookId).pipe(Effect.orDie);
          const rows = yield* likenesses(bookId);
          const passed = book.manifest.characterSlots.map((slot) =>
            rows.find((row) => row.slotId === slot.slotId && row.checkStatus === "passed" && row.photoKey),
          );
          if (book.status !== "draft" || passed.some((row) => !row)) return null;
          const uploads = passed.map((row) => `${row!.slotId}=${row!.uploadId}`).join(",");
          yield* Database.query((db) =>
            db
              .update(schema.book)
              .set({ likenessStatus: "drawing", likenessRound: 0 })
              .where(eq(schema.book.id, bookId)),
          );
          return yield* (yield* Jobs)
            .spawn(previewLikeness, { bookId, uploads }, { idempotencyKey: `likeness.preview:${bookId}:${uploads}` })
            .pipe(Effect.orDie);
        }),
      );
      return { status };
    }),
});

/** Draws a character sheet per role from its photo and the story's style reference, then the cover (D56). */
export const previewLikeness = defineTask({
  name: "likeness.preview",
  /** `uploads` names the photos (`slot=uploadId,...`), so a new photo makes a new preview. */
  params: Schema.Struct({ bookId: Schema.String, uploads: Schema.String }),
  run: ({ bookId, uploads }, ctx) =>
    Effect.gen(function* () {
      const book = yield* loadBook(bookId).pipe(Effect.orDie);
      const style = book.manifest.photo!;
      const rows = yield* step(ctx, "photos", likenesses(bookId));
      const cast = yield* Database.query((db) =>
        db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, bookId)),
      );
      const sheets: Record<string, string> = {};
      for (const slot of book.manifest.characterSlots) {
        const row = rows.find((candidate) => candidate.slotId === slot.slotId);
        const person = cast.find((candidate) => candidate.slotId === slot.slotId);
        if (!row?.photoKey || !person)
          return yield* Effect.die(new Error(`book ${bookId}: ${slot.slotId} has no photo`));
        const sheet = yield* generateImage(ctx, `sheet:${slot.slotId}`, {
          key: `sheet:${bookId}:${slot.slotId}:${row.uploadId}`,
          prompt: photoPrompts[style.promptVersion].sheet({
            style,
            age: person.age as never,
            outfit: slot.outfit,
            hair: row.hair as Hair | null,
          }),
          width: 1536,
          height: 1024,
          references: [row.photoKey, storyAssetKey(book.storyId, book.version, style.styleReference)],
          outputKey: `${bookPrefix(book.familyId, bookId)}likeness/${slot.slotId}/sheet-${row.uploadId}`,
        });
        sheets[slot.slotId] = sheet.key;
        yield* step(
          ctx,
          `sheet:${slot.slotId}:store`,
          Database.query((db) =>
            db
              .update(schema.bookLikeness)
              .set({ sheetKey: sheet.key })
              .where(and(eq(schema.bookLikeness.bookId, bookId), eq(schema.bookLikeness.slotId, slot.slotId))),
          ).pipe(Effect.as(null)),
        );
      }
      yield* drawCover(ctx, book, sheets, 0);
      return { uploads };
    }).pipe(Effect.catchTag("GenerationFailed", () => markLikenessFailed(ctx, bookId))),
});

/**
 * One round of changes to the sheets (D56, approved by Sid): each note edits that role's current sheet, one edit per
 * note, then the cover is redrawn. LIKENESS_REVISE_MODE=fresh draws a fresh sheet from the photo with the note instead.
 */
export const reviseLikeness = defineTask({
  name: "likeness.revise",
  params: Schema.Struct({ bookId: Schema.String, round: Schema.Number }),
  run: ({ bookId, round }, ctx) =>
    Effect.gen(function* () {
      const mode = yield* Config.Literals(["edit", "fresh"], "LIKENESS_REVISE_MODE").pipe(
        Config.withDefault("edit" as const),
        Effect.orDie,
      );
      const book = yield* loadBook(bookId).pipe(Effect.orDie);
      const style = book.manifest.photo!;
      const prompts = photoPrompts[style.promptVersion];
      const rows = yield* step(ctx, "likenesses", likenesses(bookId));
      const sheets = yield* sheetsAtStart(ctx, bookId);
      const cast = yield* Database.query((db) =>
        db.select().from(schema.bookCast).where(eq(schema.bookCast.bookId, bookId)),
      );
      for (const row of rows) {
        const note = row.notes.find((candidate) => candidate.round === round)?.note;
        if (!note) continue;
        const slot = book.manifest.characterSlots.find((candidate) => candidate.slotId === row.slotId)!;
        const person = cast.find((candidate) => candidate.slotId === row.slotId)!;
        const fresh = mode === "fresh" && row.photoKey;
        const sheet = yield* generateImage(ctx, `revise:${row.slotId}`, {
          key: `revise:${bookId}:${row.slotId}:${round}`,
          prompt: fresh
            ? `${prompts.sheet({ style, age: person.age as never, outfit: slot.outfit, hair: row.hair as Hair | null })} Also: ${note}.`
            : prompts.revise(note),
          width: 1536,
          height: 1024,
          references: fresh
            ? [row.photoKey!, storyAssetKey(book.storyId, book.version, style.styleReference)]
            : [sheets[row.slotId]!],
          outputKey: `${bookPrefix(book.familyId, bookId)}likeness/${row.slotId}/sheet-r${round}`,
        });
        sheets[row.slotId] = sheet.key;
        yield* step(
          ctx,
          `revise:${row.slotId}:store`,
          Database.query((db) =>
            db
              .update(schema.bookLikeness)
              .set({ sheetKey: sheet.key })
              .where(and(eq(schema.bookLikeness.bookId, bookId), eq(schema.bookLikeness.slotId, row.slotId))),
          ).pipe(Effect.as(null)),
        );
      }
      yield* drawCover(ctx, book, sheets, round);
      return { round };
    }).pipe(Effect.catchTag("GenerationFailed", () => markLikenessFailed(ctx, bookId))),
});

/**
 * Draws every figure of one page, as version `version` (D57: 1 from the order, 2 a parent's change, higher an
 * operator's redo), from the approved sheets and never the photo. The last page of an order to finish moves the book
 * on to page changes.
 */
export const drawPage = defineTask({
  name: "page.figure",
  params: Schema.Struct({
    bookId: Schema.String,
    pageId: Schema.String,
    version: Schema.Number,
    note: Schema.optionalKey(Schema.String),
  }),
  run: ({ bookId, pageId, version, note }, ctx) =>
    Effect.gen(function* () {
      const book = yield* loadBook(bookId).pipe(Effect.orDie);
      const page = book.manifest.pages.find((candidate) => candidate.pageId === pageId);
      if (!page) return yield* Effect.die(new Error(`book ${bookId} has no page ${pageId}`));
      const sheets = yield* sheetsAtStart(ctx, bookId);
      const drawn = yield* drawPageFigures(ctx, book, page, sheets, {
        tag: `v${version}`,
        outputBase: `${bookPrefix(book.familyId, bookId)}pages/${pageId}/v${version}`,
        ...(note ? { note } : {}),
      });
      yield* step(
        ctx,
        "record",
        Database.query((db) =>
          db.transaction(async (tx) => {
            for (const figure of drawn) {
              const values = {
                objectKey: figure.key,
                generationId: figure.generationId,
                iou: figure.iou,
                rescaled: figure.rescaled,
                clippedShare: figure.clippedShare,
              };
              await tx
                .insert(schema.bookPageArt)
                .values({ bookId, pageId, version, figure: figure.figure, slotId: figure.slotId, ...values })
                .onConflictDoUpdate({
                  target: [
                    schema.bookPageArt.bookId,
                    schema.bookPageArt.pageId,
                    schema.bookPageArt.version,
                    schema.bookPageArt.figure,
                  ],
                  set: values,
                });
            }
            await tx
              .update(schema.bookPage)
              .set({ ready: true })
              .where(
                and(
                  eq(schema.bookPage.bookId, bookId),
                  eq(schema.bookPage.pageId, pageId),
                  eq(schema.bookPage.latestVersion, version),
                ),
              );
            // The order's last page moves the book on; a page change or redo leaves the status alone.
            await tx.execute(sql`update book set status = 'changes'
              where id = ${bookId} and status = 'making'
              and not exists (select 1 from book_page where book_id = ${bookId} and not ready)`);
          }),
        ).pipe(Effect.as(null)),
      );
      return { pageId, version, figures: drawn.length };
    }),
});

/**
 * The order's work (D57): deletes the photos unless the parent opted in to photo review (D56), then draws every page
 * with a figure, one `page.figure` task each; the worker's concurrency bounds how many run at once.
 */
export const makeBook = defineTask({
  name: "book.make",
  params: Schema.Struct({ bookId: Schema.String }),
  run: ({ bookId }, ctx) =>
    Effect.gen(function* () {
      const book = yield* loadBook(bookId).pipe(Effect.orDie);
      yield* step(
        ctx,
        "photos",
        book.photoReview ? Effect.succeed(0) : deleteBookPhotos(book.familyId, bookId).pipe(Effect.orDie),
      );
      const pageIds = book.manifest.pages.filter((page) => pageFigures(page).length > 0).map((page) => page.pageId);
      yield* step(
        ctx,
        "pages",
        Database.query((db) =>
          db.transaction(async (tx) => {
            if (pageIds.length > 0)
              await tx
                .insert(schema.bookPage)
                .values(pageIds.map((pageId) => ({ bookId, pageId })))
                .onConflictDoNothing();
            await tx
              .update(schema.book)
              .set({ status: pageIds.length > 0 ? "making" : "changes" })
              .where(and(eq(schema.book.id, bookId), eq(schema.book.status, "ordered")));
          }),
        ).pipe(Effect.as(null)),
      );
      yield* step(
        ctx,
        "spawn",
        Effect.forEach(pageIds, (pageId) =>
          Jobs.use((jobs) =>
            jobs.spawn(
              drawPage,
              { bookId, pageId, version: 1 },
              { idempotencyKey: `page.figure:${bookId}:${pageId}:v1` },
            ),
          ),
        ).pipe(Effect.orDie, Effect.as(pageIds.length)),
      );
      return { pages: pageIds.length };
    }),
});

/**
 * After the operator's decision (D57): deletes any photos kept for review. When print ordering arrives, sending the
 * file to the printer becomes the step before this one.
 */
export const releaseBook = defineTask({
  name: "book.release",
  params: Schema.Struct({ bookId: Schema.String }),
  run: ({ bookId }, ctx) =>
    Effect.gen(function* () {
      const [row] = yield* Database.query((db) =>
        db.select({ familyId: schema.book.familyId }).from(schema.book).where(eq(schema.book.id, bookId)),
      );
      if (!row) return { photos: 0 };
      const photos = yield* step(ctx, "photos", deleteBookPhotos(row.familyId, bookId).pipe(Effect.orDie));
      return { photos };
    }),
});
