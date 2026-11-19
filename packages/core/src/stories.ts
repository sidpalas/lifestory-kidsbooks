import { isDeepStrictEqual } from "node:util";
import { schema } from "@lifestory/db";
import { and, asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { Effect } from "effect";
import {
  type CastMember,
  decodeStoryManifest,
  exampleCast,
  manifestAssets,
  storyAssetKey,
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
  const [row] = yield* Database.query((db) =>
    db
      .select({
        id: schema.story.id,
        slug: schema.story.slug,
        title: schema.story.title,
        summary: schema.story.summary,
        authorName: schema.user.name,
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
  const { version, manifest: _, ...story } = row;
  const cast: Record<string, CastMember> = Object.fromEntries(
    Object.entries(exampleCast(manifest)).map(([slotId, example]) => [slotId, { ...example, look: looks[slotId] ?? example.look }]),
  );
  for (const [slotId, member] of Object.entries(cast)) {
    const axes = unsupportedOptions(manifest, slotId, member.look);
    if (axes.length > 0) return yield* new UnsupportedLook({ slotId, axes: [...axes] });
  }
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
 * is left as it is. A version that exists with a different manifest is a defect,
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
  const storage = yield* ObjectStorage;
  for (const asset of manifestAssets(manifest)) {
    const file = yield* Effect.promise(() => input.readAsset(asset));
    yield* storage.put(storyAssetKey(input.storyId, input.version, asset), file.body, file.contentType);
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
