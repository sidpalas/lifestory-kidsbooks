// The durable workflows of a photo book (D56, D57): checking each photo, drawing each person's character sheet and
// the cover, the order's page drawing, and releasing the photos. Every side effect is a step and every image
// goes through `generateImage`, so a rerun never pays twice; object keys derive from the book, page, slot, version
// and upload, so a rerun overwrites the same objects.
import { schema } from "@lifestory/db";
import type { TaskContext } from "absurd-sdk";
import { and, eq, sql } from "drizzle-orm";
import { Config, Effect, Schema } from "effect";

import { type Age, coverPage, type Page, pageFigures, type PhotoFigure, storyAssetKey } from "../book-format/index.ts";
import { loadBook } from "../books.ts";
import { LookChoices, lookOf, PhotoCheckResult, type PhotoReport } from "../contracts.ts";
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
  options: {
    readonly tag: string;
    readonly outputBase: string;
    readonly note?: string;
    /** Each person's expressions, which v3 prompts send along with the sheet. */
    readonly expressions?: Readonly<Record<string, string>>;
  },
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
    const expressions = style.promptVersion === "photo-hero-v3" ? options.expressions?.[figure.slotId] : undefined;
    // Each try that comes back usable is kept; one the checks accept ends the tries, else the least clipped wins.
    let result: DrawnFigure | null = null;
    let accepted = false;
    for (let attempt = 0; attempt < ATTEMPTS && !accepted; attempt++) {
      const generated = yield* generateImage(ctx, `${name}:a${attempt}`, {
        key: `figure:${book.id}:${options.tag}:${page.pageId}:${index}:${attempt}`,
        prompt: photoPrompts[style.promptVersion].figure({
          style,
          ...(options.note ? { note: options.note } : {}),
          ...(expressions ? { expressions: true } : {}),
        }),
        ...size,
        references: expressions ? [referenceKey, sheet, expressions] : [referenceKey, sheet],
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

/** Each role's expressions key, read in its own step like `sheetsAtStart`. */
const expressionsAtStart = (ctx: TaskContext, bookId: string) =>
  step(
    ctx,
    "expressions",
    likenesses(bookId).pipe(
      Effect.map((rows) =>
        Object.fromEntries(
          rows.flatMap((row) => (row.expressionsKey ? [[row.slotId, row.expressionsKey] as const] : [])),
        ),
      ),
    ),
  );

/**
 * Draws the cover from the current sheets and marks the likeness ready, unless meanwhile another person's sheet
 * started drawing or a new photo cleared one: that drawing draws the cover again.
 */
const drawCover = Effect.fn("photoBooks.drawCover")(function* (
  ctx: TaskContext,
  book: LoadedBook,
  sheets: Readonly<Record<string, string>>,
  drawId: string,
) {
  const page = coverPage(book.manifest);
  const cover = page
    ? yield* drawPageFigures(ctx, book, page, sheets, {
        tag: `cover-${drawId}`,
        outputBase: `${bookPrefix(book.familyId, book.id)}likeness/cover/${drawId}`,
        expressions: yield* expressionsAtStart(ctx, book.id),
      })
    : [];
  yield* step(
    ctx,
    "ready",
    Database.query((db) =>
      db
        .update(schema.book)
        .set({ cover: cover.map((figure) => figure.key), likenessStatus: "ready" })
        .where(
          and(
            eq(schema.book.id, book.id),
            sql`not exists (select 1 from ${schema.bookLikeness} where ${schema.bookLikeness.bookId} = ${book.id}
              and (${schema.bookLikeness.drawing} or ${schema.bookLikeness.sheetKey} is null))`,
          ),
        ),
    ).pipe(Effect.as(null)),
  );
});

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
 * code. A refused photo is deleted at once. A passed photo is drawn only when the parent asks ("Draw {name}").
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
          const [person] = yield* Database.query((db) =>
            db
              .select({ age: schema.bookCast.age })
              .from(schema.bookCast)
              .where(and(eq(schema.bookCast.bookId, bookId), eq(schema.bookCast.slotId, slotId))),
          );
          const result: PhotoCheckResult = report
            ? judgePhoto(report, { ages: slot?.ages ?? [], ...(person ? { chosen: person.age as Age } : {}) })
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
      return { status };
    }),
});

/**
 * Draws one person's character sheet (D56), as the parent asked: "Draw {name}" draws it from the photo and the
 * story's style reference; a note edits the current sheet (LIKENESS_REVISE_MODE=fresh draws a fresh sheet from the
 * photo with the note instead). Once every person has a sheet and none is drawing, draws the cover. A failed drawing
 * gives the person's drawing back.
 */
export const drawLikenessSheet = defineTask({
  name: "likeness.sheet",
  /** `draw` is the person's drawing number (1 to MAX_SHEET_DRAWS); `drawId` keys its generations and objects. */
  params: Schema.Struct({ bookId: Schema.String, slotId: Schema.String, draw: Schema.Number, drawId: Schema.String }),
  run: ({ bookId, slotId, draw, drawId }, ctx) =>
    Effect.gen(function* () {
      const mode = yield* Config.Literals(["edit", "fresh"], "LIKENESS_REVISE_MODE").pipe(
        Config.withDefault("edit" as const),
        Effect.orDie,
      );
      const book = yield* loadBook(bookId).pipe(Effect.orDie);
      const style = book.manifest.photo!;
      const prompts = photoPrompts[style.promptVersion];
      const slot = book.manifest.characterSlots.find((candidate) => candidate.slotId === slotId);
      const row = yield* step(
        ctx,
        "likeness",
        likenesses(bookId).pipe(Effect.map((rows) => rows.find((candidate) => candidate.slotId === slotId) ?? null)),
      );
      // The look the parent confirmed when they asked for the drawing, read once so a rerun draws the same.
      const person = yield* step(
        ctx,
        "person",
        Database.query((db) =>
          db
            .select({ age: schema.bookCast.age, look: schema.bookCast.look })
            .from(schema.bookCast)
            .where(and(eq(schema.bookCast.bookId, bookId), eq(schema.bookCast.slotId, slotId))),
        ).pipe(Effect.map(([found]) => found ?? null)),
      );
      if (!slot || !row?.photoKey || !person)
        return yield* Effect.die(new Error(`book ${bookId}: ${slotId} has no photo`));
      const note = row.notes.findLast((candidate) => candidate.round === draw)?.note;
      const fresh = !note || !row.sheetKey || mode === "fresh";
      const sheetPrompt = prompts.sheet({
        style,
        age: person.age as never,
        outfit: slot.outfit,
        look: lookOf(
          (row.check as PhotoCheckResult | null)?.report,
          yield* Schema.decodeUnknownEffect(LookChoices)(person.look).pipe(Effect.orDie),
        ),
      });
      const sheet = yield* generateImage(ctx, "sheet", {
        key: `sheet:${bookId}:${slotId}:${drawId}`,
        prompt: !note ? sheetPrompt : fresh ? `${sheetPrompt} Also: ${note}.` : prompts.revise(note),
        width: 1536,
        height: 1024,
        references: fresh
          ? [row.photoKey, storyAssetKey(book.storyId, book.version, style.styleReference)]
          : [row.sheetKey!],
        outputKey: `${bookPrefix(book.familyId, bookId)}likeness/${slotId}/sheet-${drawId}`,
      });
      // The same person in several expressions, from the sheet just drawn, so the parent judges the likeness beyond
      // one face, and v3 pages draw a sleeping or sad face from the person's own.
      const expressions = yield* generateImage(ctx, "expressions", {
        key: `expressions:${bookId}:${slotId}:${drawId}`,
        prompt: prompts.expressions({ style }),
        width: 1536,
        height: 1024,
        references: [sheet.key],
        outputKey: `${bookPrefix(book.familyId, bookId)}likeness/${slotId}/expressions-${drawId}`,
      });
      // Store the sheet, then see whether the cover is due: every person drawn and nobody drawing.
      const sheets = yield* step(
        ctx,
        "store",
        Effect.gen(function* () {
          yield* Database.query((db) =>
            db
              .update(schema.bookLikeness)
              .set({ sheetKey: sheet.key, expressionsKey: expressions.key, drawing: false })
              .where(and(eq(schema.bookLikeness.bookId, bookId), eq(schema.bookLikeness.slotId, slotId))),
          );
          const rows = yield* likenesses(bookId);
          if (rows.some((candidate) => candidate.drawing)) return null;
          const drawn = book.manifest.characterSlots.map(
            (candidate) => rows.find((r) => r.slotId === candidate.slotId)?.sheetKey,
          );
          if (drawn.some((key) => !key)) {
            yield* Database.query((db) =>
              db.update(schema.book).set({ likenessStatus: "waiting" }).where(eq(schema.book.id, bookId)),
            );
            return null;
          }
          return Object.fromEntries(rows.flatMap((r) => (r.sheetKey ? [[r.slotId, r.sheetKey] as const] : [])));
        }),
      );
      if (sheets) yield* drawCover(ctx, book, sheets, drawId);
      return { draw };
    }).pipe(
      Effect.catchTag("GenerationFailed", () =>
        step(
          ctx,
          "failed",
          Database.query((db) =>
            db.transaction(async (tx) => {
              await tx
                .update(schema.bookLikeness)
                .set({ drawing: false, draws: sql`${schema.bookLikeness.draws} - 1` })
                .where(
                  and(
                    eq(schema.bookLikeness.bookId, bookId),
                    eq(schema.bookLikeness.slotId, slotId),
                    eq(schema.bookLikeness.drawing, true),
                  ),
                );
              await tx.update(schema.book).set({ likenessStatus: "failed" }).where(eq(schema.book.id, bookId));
            }),
          ).pipe(Effect.as(null)),
        ),
      ),
    ),
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
        expressions: yield* expressionsAtStart(ctx, bookId),
        tag: `v${version}`,
        outputBase: `${bookPrefix(book.familyId, bookId)}pages/${pageId}/v${version}`,
        ...(note ? { note } : {}),
      });
      yield* step(
        ctx,
        "record",
        Database.query((db) =>
          db.transaction(async (tx) => {
            // Pages finishing together take turns here, so the last one sees every other page ready; without the
            // lock, two last pages each saw the other's page not yet ready and the book stayed "making" for good.
            await tx.execute(sql`select 1 from book where id = ${bookId} for update`);
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
