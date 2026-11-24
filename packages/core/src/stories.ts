import { isDeepStrictEqual } from "node:util";

import { schema } from "@lifestory/db";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";

import {
  composePage,
  decodeStoryManifest,
  exampleCast,
  isVariableFont,
  manifestAssets,
  staticFontIssues,
  storyAssetKey,
  type StoryManifest,
} from "./book-format/index.ts";
import type { StorySummary } from "./contracts.ts";
import { Database } from "./database.ts";
import { NotFound } from "./errors.ts";
import { printTrimIssues } from "./print-ready.ts";
import { ObjectStorage } from "./storage.ts";

/** Published stories, the catalogue a family picks from. */
export const listPublishedStories = Effect.fn("stories.listPublished")(function* () {
  const rows = yield* Database.query((db) =>
    db
      .select({
        id: schema.story.id,
        slug: schema.story.slug,
        title: schema.story.title,
        summary: schema.story.summary,
        authorName: schema.user.name,
      })
      .from(schema.story)
      .innerJoin(schema.user, eq(schema.user.id, schema.story.authorId))
      .where(eq(schema.story.status, "published"))
      .orderBy(asc(schema.story.title)),
  );
  return rows satisfies ReadonlyArray<StorySummary>;
});

/**
 * Who may read a story version: a published version of a published story, anyone; of a story not published yet, its
 * author. An unpublished version is the author's draft (D37), read only through authoring and its files.
 */
const readableBy = (userId: string) =>
  and(
    isNotNull(schema.storyVersion.publishedAt),
    or(eq(schema.story.authorId, userId), eq(schema.story.status, "published")),
  );

/** The newest version of a story that `userId` may read, decoded. Fails with NotFound when there is none. */
export const readableStoryVersion = Effect.fn("stories.readableVersion")(function* (userId: string, slug: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        id: schema.story.id,
        slug: schema.story.slug,
        title: schema.story.title,
        summary: schema.story.summary,
        authorName: schema.user.name,
        status: schema.story.status,
        storyVersionId: schema.storyVersion.id,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
      })
      .from(schema.story)
      .innerJoin(schema.user, eq(schema.user.id, schema.story.authorId))
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.storyId, schema.story.id))
      .where(and(eq(schema.story.slug, slug), readableBy(userId)))
      .orderBy(desc(schema.storyVersion.version))
      .limit(1),
  );
  if (!row) return yield* new NotFound({ entity: "story", id: slug });
  const manifest: StoryManifest = yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie);
  const { storyVersionId, version, manifest: _, status, ...story } = row;
  // Only its author reads an archived story (D49), to preview it; nobody makes a book of it.
  return {
    story: story satisfies StorySummary,
    archived: status === "archived",
    storyVersionId,
    version,
    manifest,
  };
});

/**
 * A story with the newest version `userId` may read, for previewing its pages: the illustrator's stock characters on
 * every page (D56), named by each role's example. Fails with NotFound when the story doesn't exist or isn't visible
 * to the user.
 */
export const getStoryPreview = Effect.fn("stories.getPreview")(function* (userId: string, slug: string) {
  const { story, archived, version, manifest } = yield* readableStoryVersion(userId, slug);
  const pages = manifest.pages.map((page) => ({
    pageId: page.pageId,
    layers: composePage({ storyId: story.id, version }, page),
  }));
  return { story, archived, version, manifest, cast: exampleCast(manifest), pages };
});

// No ".." anywhere: some S3 servers normalize paths, which would let a key climb out of the story.
const STORY_ASSET_KEY = /^(?!.*\.\.)stories\/([^/]+)\/v(\d+)\/.+$/;

/**
 * Whether `userId` may download the object at `key` under `stories/`: by the same rule as getStoryPreview, or as a
 * member of a family with a book of that version, so books of an archived story (D49) still draw.
 */
export const canReadStoryAsset = Effect.fn("stories.canReadAsset")(function* (userId: string, key: string) {
  const match = STORY_ASSET_KEY.exec(key);
  if (!match) return false;
  const [, storyId, version] = match;
  // The author reads every version's files, including the unpublished draft's (D37).
  const authored = yield* Database.query((db) =>
    db
      .select({ id: schema.story.id })
      .from(schema.story)
      .where(and(eq(schema.story.id, storyId!), eq(schema.story.authorId, userId))),
  );
  if (authored.length > 0) return true;
  const rows = yield* Database.query((db) =>
    db
      .select({ id: schema.storyVersion.id })
      .from(schema.storyVersion)
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .where(
        and(
          eq(schema.storyVersion.storyId, storyId!),
          eq(schema.storyVersion.version, Number(version)),
          readableBy(userId),
        ),
      )
      .limit(1),
  );
  if (rows.length > 0) return true;
  const booked = yield* Database.query((db) =>
    db
      .select({ id: schema.book.id })
      .from(schema.book)
      .innerJoin(schema.storyVersion, eq(schema.storyVersion.id, schema.book.storyVersionId))
      .innerJoin(
        schema.member,
        and(eq(schema.member.organizationId, schema.book.familyId), eq(schema.member.userId, userId)),
      )
      .where(and(eq(schema.storyVersion.storyId, storyId!), eq(schema.storyVersion.version, Number(version))))
      .limit(1),
  );
  return booked.length > 0;
});

export interface StoryVersionImport {
  readonly id: string;
  readonly storyId: string;
  readonly version: number;
  /** Unvalidated manifest JSON, as an author would upload it. */
  readonly manifest: unknown;
  /** Reads an asset the manifest references, by its path in the manifest. */
  readonly readAsset: (asset: string) => Promise<{ readonly body: Uint8Array; readonly contentType: string }>;
  readonly publishedAt: Date | null;
}

/**
 * Writes a version's files under its folder. A version's files never change once written, like its manifest: books,
 * proofs, and figures were drawn from them. Every file is compared before anything is written, so a
 * refused write changes nothing; only files still missing (an import that stopped partway) are uploaded.
 */
const storeVersionFiles = Effect.fn("stories.storeVersionFiles")(function* (
  storyId: string,
  version: number,
  files: ReadonlyArray<{ readonly asset: string; readonly body: Uint8Array; readonly contentType: string }>,
) {
  const storage = yield* ObjectStorage;
  const storedKeys = new Set((yield* storage.list(storyAssetKey(storyId, version, ""))).map((object) => object.key));
  const missing: Array<(typeof files)[number]> = [];
  const changed: Array<string> = [];
  for (const file of files) {
    const key = storyAssetKey(storyId, version, file.asset);
    if (!storedKeys.has(key)) missing.push(file);
    else if (!Buffer.from((yield* storage.get(key)).body).equals(file.body)) changed.push(file.asset);
  }
  if (changed.length > 0) {
    return yield* Effect.die(
      new Error(`story ${storyId} v${version} already has different files; add a new version:\n${changed.join("\n")}`),
    );
  }
  for (const file of missing)
    yield* storage.put(storyAssetKey(storyId, version, file.asset), file.body, file.contentType);
});

/**
 * Validates a story version, uploads its assets, and records it. Idempotent: assets
 * are written to keys derived from the story and version, and an existing version
 * is left as it is. A version whose stored manifest or files differ is a defect,
 * because published versions never change; add a new version instead.
 */
export const importStoryVersion = Effect.fn("stories.importVersion")(function* (input: StoryVersionImport) {
  const manifest: StoryManifest = yield* decodeStoryManifest(input.manifest).pipe(Effect.orDie);
  // The trim must suit the printer: Lulu's bleed and safe margin (D35). Checked here, like fonts below, so versions
  // stored before the rule stay readable.
  const trimProblems = printTrimIssues(manifest.trim);
  if (trimProblems.length > 0) {
    return yield* Effect.die(
      new Error(`story ${input.storyId} v${input.version} won't print:\n${trimProblems.join("\n")}`),
    );
  }
  // Fonts must be static so PDFs embed them as real fonts, not Type 3 (D27). Checked here, not when decoding,
  // so versions stored before the rule stay readable.
  const fontAssets = new Set(manifest.fonts.map((font) => font.asset));
  const files = yield* Effect.forEach(manifestAssets(manifest), (asset) =>
    Effect.promise(() => input.readAsset(asset)).pipe(Effect.map((file) => ({ asset, ...file }))),
  );
  const fontProblems = [
    ...staticFontIssues(manifest),
    ...files
      .filter((file) => fontAssets.has(file.asset) && isVariableFont(file.body))
      .map((file) => `${file.asset}: variable font; use static instances`),
  ];
  if (fontProblems.length > 0) {
    return yield* Effect.die(
      new Error(`story ${input.storyId} v${input.version} has fonts that won't print:\n${fontProblems.join("\n")}`),
    );
  }
  yield* storeVersionFiles(input.storyId, input.version, files);
  const [stored] = yield* Database.query(async (db) => {
    await db
      .insert(schema.storyVersion)
      .values({
        id: input.id,
        storyId: input.storyId,
        version: input.version,
        manifest,
        publishedAt: input.publishedAt,
      })
      .onConflictDoNothing();
    return db
      .select({ manifest: schema.storyVersion.manifest })
      .from(schema.storyVersion)
      .where(and(eq(schema.storyVersion.storyId, input.storyId), eq(schema.storyVersion.version, input.version)));
  });
  // jsonb doesn't keep key order, so compare structurally, and decode the stored one the same way.
  const storedManifest = stored ? yield* decodeStoryManifest(stored.manifest).pipe(Effect.orDie) : undefined;
  if (!isDeepStrictEqual(storedManifest, manifest)) {
    return yield* Effect.die(
      new Error(`story ${input.storyId} v${input.version} already exists with a different manifest; add a new version`),
    );
  }
});
