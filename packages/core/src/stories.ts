import { isDeepStrictEqual } from "node:util";
import { schema } from "@lifestory/db";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";
import {
  type CastMember,
  decodeStoryManifest,
  exampleCast,
  isVariableFont,
  manifestAssets,
  storyAssetKey,
  staticFontIssues,
  unapprovedParts,
  unsupportedOptions,
  vocabularyGaps,
  type StoryManifest,
} from "./book-format/index.ts";
import type { StorySummary } from "./contracts.ts";
import { Database } from "./database.ts";
import { NotFound, UnsupportedLook } from "./errors.ts";
import { composeIllustration } from "./looks/compose.ts";
import type { Look } from "./looks/vocabulary.ts";
import { resolveIllustration } from "./pages.ts";
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

/** Who may read a story version: anyone once the story and version are published, and its author always. */
const readableBy = (userId: string) =>
  or(
    eq(schema.story.authorId, userId),
    and(eq(schema.story.status, "published"), isNotNull(schema.storyVersion.publishedAt)),
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
  // Every stored manifest was validated when it was imported, so a failure here is a bug.
  const manifest = yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie);
  const { storyVersionId, version, manifest: _, ...story } = row;
  return { story: story satisfies StorySummary, storyVersionId, version, manifest };
});

/** Fails with UnsupportedLook when the story can't draw someone in `cast` (D26). */
export const checkCastSupported = (manifest: StoryManifest, cast: Readonly<Record<string, CastMember>>) =>
  Effect.forEach(Object.entries(cast), ([slotId, member]) => {
    const axes = unsupportedOptions(manifest, slotId, member.look);
    return axes.length > 0 ? Effect.fail(new UnsupportedLook({ slotId, axes: [...axes] })) : Effect.void;
  }, { discard: true });

/** The cast of a story preview: each slot's example character, with the look from `looks` where one is given. */
export const previewCast = (manifest: StoryManifest, looks: Readonly<Record<string, Look>>): Record<string, CastMember> =>
  Object.fromEntries(
    Object.entries(exampleCast(manifest)).map(([slotId, example]) => [slotId, { ...example, look: looks[slotId] ?? example.look }]),
  );

/**
 * A story with the newest version `userId` may read, for previewing its pages: each slot filled by its example,
 * or with `looks` given per slot, the example's name and pronouns with that look. Every page's illustration comes
 * back composed, as storage keys. Fails with NotFound when the story doesn't exist or isn't visible to the user,
 * and with UnsupportedLook when the story can't draw a given look.
 */
export const getStoryPreview = Effect.fn("stories.getPreview")(function* (
  userId: string,
  slug: string,
  looks: Readonly<Record<string, Look>> = {},
) {
  const { story, version, manifest } = yield* readableStoryVersion(userId, slug);
  const cast = previewCast(manifest, looks);
  yield* checkCastSupported(manifest, cast);
  const pages = yield* Effect.forEach(manifest.pages, (page) =>
    resolveIllustration(story.id, version, composeIllustration(manifest, page, cast)).pipe(
      Effect.map((layers) => ({ pageId: page.pageId, layers })),
    ),
  );
  return { story, version, manifest, cast, pages };
});

// No ".." anywhere: some S3 servers normalize paths, which would let a key climb out of the story.
const STORY_ASSET_KEY = /^(?!.*\.\.)stories\/([^/]+)\/v(\d+)\/.+$/;

/** Whether `userId` may download the object at `key` under `stories/`, by the same rule as getStoryPreview. */
export const canReadStoryAsset = Effect.fn("stories.canReadAsset")(function* (userId: string, key: string) {
  const match = STORY_ASSET_KEY.exec(key);
  if (!match) return false;
  const [, storyId, version] = match;
  const rows = yield* Database.query((db) =>
    db
      .select({ id: schema.storyVersion.id })
      .from(schema.storyVersion)
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .where(and(eq(schema.storyVersion.storyId, storyId!), eq(schema.storyVersion.version, Number(version)), readableBy(userId)))
      .limit(1),
  );
  return rows.length > 0;
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
 * Validates a story version, uploads its assets, and records it. Idempotent: assets
 * are written to keys derived from the story and version, and an existing version
 * is left as it is. A version whose stored manifest or files differ is a defect,
 * because published versions never change; add a new version instead.
 */
export const importStoryVersion = Effect.fn("stories.importVersion")(function* (input: StoryVersionImport) {
  const manifest: StoryManifest = yield* decodeStoryManifest(input.manifest).pipe(Effect.orDie);
  if (input.publishedAt) {
    // Publishing needs every part approved and the whole look vocabulary covered (D26).
    const problems = [...unapprovedParts(manifest).map((part) => `not approved: ${part}`), ...vocabularyGaps(manifest)];
    if (problems.length > 0) {
      return yield* Effect.die(new Error(`story ${input.storyId} v${input.version} can't be published:\n${problems.join("\n")}`));
    }
  }
  // The trim must suit the printer: Lulu's bleed and safe margin (D35). Checked here, like fonts below, so versions
  // stored before the rule stay readable.
  const trimProblems = printTrimIssues(manifest.trim);
  if (trimProblems.length > 0) {
    return yield* Effect.die(new Error(`story ${input.storyId} v${input.version} won't print:\n${trimProblems.join("\n")}`));
  }
  // Fonts must be static so PDFs embed them as real fonts, not Type 3 (D27). Checked here, not when decoding,
  // so versions stored before the rule stay readable.
  const fontAssets = new Set(manifest.fonts.map((font) => font.asset));
  const files = yield* Effect.forEach(manifestAssets(manifest), (asset) =>
    Effect.promise(() => input.readAsset(asset)).pipe(Effect.map((file) => ({ asset, ...file }))),
  );
  const fontProblems = [
    ...staticFontIssues(manifest),
    ...files.filter((file) => fontAssets.has(file.asset) && isVariableFont(file.body)).map((file) => `${file.asset}: variable font; use static instances`),
  ];
  if (fontProblems.length > 0) {
    return yield* Effect.die(new Error(`story ${input.storyId} v${input.version} has fonts that won't print:\n${fontProblems.join("\n")}`));
  }
  // A version's files never change once written, like its manifest: books, proofs, and the recolour cache were made
  // from them. Every file is compared before anything is written, so a refused import changes nothing; only files
  // still missing (an import that stopped partway) are uploaded.
  const storage = yield* ObjectStorage;
  const storedKeys = new Set((yield* storage.list(storyAssetKey(input.storyId, input.version, ""))).map((object) => object.key));
  const missing: typeof files = [];
  const changed: Array<string> = [];
  for (const file of files) {
    const key = storyAssetKey(input.storyId, input.version, file.asset);
    if (!storedKeys.has(key)) missing.push(file);
    else if (!Buffer.from((yield* storage.get(key)).body).equals(file.body)) changed.push(file.asset);
  }
  if (changed.length > 0) {
    return yield* Effect.die(
      new Error(`story ${input.storyId} v${input.version} already has different files; add a new version:\n${changed.join("\n")}`),
    );
  }
  for (const file of missing) {
    yield* storage.put(storyAssetKey(input.storyId, input.version, file.asset), file.body, file.contentType);
  }
  const [stored] = yield* Database.query(async (db) => {
    await db
      .insert(schema.storyVersion)
      .values({ id: input.id, storyId: input.storyId, version: input.version, manifest, publishedAt: input.publishedAt })
      .onConflictDoNothing();
    return db
      .select({ manifest: schema.storyVersion.manifest })
      .from(schema.storyVersion)
      .where(and(eq(schema.storyVersion.storyId, input.storyId), eq(schema.storyVersion.version, input.version)));
  });
  // jsonb doesn't keep key order, so compare structurally.
  if (!isDeepStrictEqual(stored?.manifest, manifest)) {
    return yield* Effect.die(
      new Error(`story ${input.storyId} v${input.version} already exists with a different manifest; add a new version`),
    );
  }
});
