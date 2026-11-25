// Story authoring (D37): an author creates a story, works on a draft of its next version (trim, fonts, text styles,
// roles, pages with their art and figures, text), and publishes it, through the same checks the seed's import runs.
// A draft is the story's unpublished story_version row; publishing sets its published_at, after which it never
// changes. Who may author: the operator, and accounts the operator grants.
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";

import { schema } from "@lifestory/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, SchemaIssue } from "effect";

import type { SessionUser } from "./auth.ts";
import {
  composePage,
  decodeStoryDraft,
  decodeStoryManifest,
  FORMAT_VERSION,
  isVariableFont,
  manifestAssets,
  presetFrame,
  type StoryDraft,
  staticFontIssues,
  storyAgreementIssues,
  storyAssetKey,
} from "./book-format/index.ts";
import type { AuthoredStory } from "./contracts.ts";
import { Database } from "./database.ts";
import { DraftChanged, Forbidden, InvalidInput, NotFound, StoryNotPublishable } from "./errors.ts";
import { printTrimIssues } from "./print-ready.ts";
import { ObjectStorage } from "./storage.ts";

// ---- Who may author ------------------------------------------------------------

/** The operator, or an account the operator granted authoring (D37). */
export const canAuthor = Effect.fn("authoring.canAuthor")(function* (user: Pick<SessionUser, "id" | "role">) {
  if (user.role === "admin") return true;
  const rows = yield* Database.query((db) =>
    db
      .select({ userId: schema.storyAuthor.userId })
      .from(schema.storyAuthor)
      .where(eq(schema.storyAuthor.userId, user.id)),
  );
  return rows.length > 0;
});

const requireAuthor = (user: Pick<SessionUser, "id" | "role">) =>
  canAuthor(user).pipe(
    Effect.flatMap((allowed) =>
      allowed ? Effect.void : Effect.fail(new Forbidden({ message: "Only authors can write stories." })),
    ),
  );

const requireOperator = (user: Pick<SessionUser, "role">) =>
  user.role === "admin"
    ? Effect.void
    : Effect.fail(new Forbidden({ message: "Only the operator can change who authors." }));

/** Accounts granted authoring, for the operator. */
export const listAuthors = Effect.fn("authoring.listAuthors")(function* (operator: SessionUser) {
  yield* requireOperator(operator);
  return yield* Database.query((db) =>
    db
      .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email })
      .from(schema.storyAuthor)
      .innerJoin(schema.user, eq(schema.user.id, schema.storyAuthor.userId))
      .orderBy(schema.user.name),
  );
});

/** Lets an existing account author stories. Idempotent. */
export const grantAuthor = Effect.fn("authoring.grantAuthor")(function* (operator: SessionUser, email: string) {
  yield* requireOperator(operator);
  const [found] = yield* Database.query((db) =>
    db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email.trim().toLowerCase())),
  );
  if (!found) return yield* new NotFound({ entity: "account", id: email });
  yield* Database.query((db) =>
    db.insert(schema.storyAuthor).values({ userId: found.id, grantedBy: operator.id }).onConflictDoNothing(),
  );
});

/** Stops an account authoring. Its stories stay its own, published versions stay published, and drafts wait. */
export const revokeAuthor = Effect.fn("authoring.revokeAuthor")(function* (operator: SessionUser, userId: string) {
  yield* requireOperator(operator);
  yield* Database.query((db) => db.delete(schema.storyAuthor).where(eq(schema.storyAuthor.userId, userId)));
});

// ---- Stories and drafts --------------------------------------------------------

/** Lulu's bleed and 0.5 in safe margin, which publishing requires (D35). */
const STARTER_TRIM = { widthIn: 8.5, heightIn: 8.5, bleedIn: 0.125, safeMarginIn: 0.5 };

const starterDraft = (title: string): StoryDraft => ({
  formatVersion: FORMAT_VERSION,
  trim: STARTER_TRIM,
  fonts: [],
  // No font yet: the author uploads one and picks it, and the check says so until then.
  textStyles: {
    title: { fontFamily: "", sizePt: 30, lineHeight: 1.15, weight: 700, align: "center" },
    body: { fontFamily: "", sizePt: 17, lineHeight: 1.45, weight: 400, align: "left" },
  },
  characterSlots: [],
  pages: [
    {
      pageId: "p01",
      art: "full-bleed",
      frames: [presetFrame(STARTER_TRIM, "bottom", "t1", [{ style: "title", content: title }])],
      illustration: { layers: [] },
    },
  ],
});

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const versionId = (storyId: string, version: number) => `${storyId}_v${version}`;

/** The newest published (or unpublished: the draft's) version number of the story in the query. */
const newestVersion = (published: boolean) =>
  sql<
    number | null
  >`(select max(${schema.storyVersion.version}) from ${schema.storyVersion} where ${schema.storyVersion.storyId} = ${schema.story.id} and ${schema.storyVersion.publishedAt} ${published ? sql`is not null` : sql`is null`})`.mapWith(
    (v) => (v === null ? null : Number(v)),
  );

/** The stories `user` wrote, with the version they're working on and the newest they published. */
export const listAuthoredStories = Effect.fn("authoring.listStories")(function* (user: SessionUser) {
  const rows = yield* Database.query((db) =>
    db
      .select({
        id: schema.story.id,
        slug: schema.story.slug,
        title: schema.story.title,
        summary: schema.story.summary,
        status: schema.story.status,
        draftVersion: newestVersion(false),
        publishedVersion: newestVersion(true),
      })
      .from(schema.story)
      .where(eq(schema.story.authorId, user.id))
      .orderBy(desc(schema.story.updatedAt)),
  );
  return rows satisfies ReadonlyArray<AuthoredStory>;
});

/** A new story by `user`, in draft, with version 1 started from a one-page starter. */
export const createStory = Effect.fn("authoring.createStory")(function* (
  user: SessionUser,
  input: { readonly title: string; readonly slug: string; readonly summary: string },
) {
  yield* requireAuthor(user);
  if (!SLUG.test(input.slug))
    return yield* new InvalidInput({ message: "The address may use lowercase letters, digits, and dashes." });
  const id = `story_${randomUUID()}`;
  const created = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.story)
        .values({ id, authorId: user.id, slug: input.slug, title: input.title, summary: input.summary })
        .onConflictDoNothing()
        .returning({ id: schema.story.id });
      if (!row) return false;
      await tx.insert(schema.storyVersion).values({
        id: versionId(id, 1),
        storyId: id,
        version: 1,
        manifest: starterDraft(input.title),
        publishedAt: null,
      });
      return true;
    }),
  );
  if (!created) return yield* new InvalidInput({ message: `The address "${input.slug}" is taken; pick another.` });
  return { id, slug: input.slug };
});

/** The story and its draft (its unpublished version), when `user` wrote it and may author. NotFound otherwise. */
const ownedDraft = Effect.fn("authoring.ownedDraft")(function* (user: SessionUser, storyId: string) {
  yield* requireAuthor(user);
  const [story] = yield* Database.query((db) =>
    db
      .select()
      .from(schema.story)
      .where(and(eq(schema.story.id, storyId), eq(schema.story.authorId, user.id))),
  );
  if (!story) return yield* new NotFound({ entity: "story", id: storyId });
  const [draft] = yield* Database.query((db) =>
    db
      .select({
        id: schema.storyVersion.id,
        version: schema.storyVersion.version,
        revision: schema.storyVersion.revision,
        manifest: schema.storyVersion.manifest,
      })
      .from(schema.storyVersion)
      .where(and(eq(schema.storyVersion.storyId, storyId), isNull(schema.storyVersion.publishedAt))),
  );
  return { story, draft: draft ?? null };
});

const requireDraft = <T extends { readonly draft: unknown }>(owned: T, storyId: string) =>
  owned.draft
    ? Effect.succeed(owned as T & { readonly draft: NonNullable<T["draft"]> })
    : Effect.fail(new NotFound({ entity: "draft", id: storyId }));

const draftOf = (user: SessionUser, storyId: string) =>
  ownedDraft(user, storyId).pipe(Effect.flatMap((owned) => requireDraft(owned, storyId)));

// Every stored draft was decoded on the way in, so a failure here is a bug.
const decodeDraft = (manifest: unknown) => decodeStoryDraft(manifest).pipe(Effect.orDie);

/** A draft's pages as storage keys: the art, and each figure's stock drawing, or its bald reference until there is one. */
const draftPages = (storyId: string, version: number, draft: StoryDraft) =>
  draft.pages.map((page) => ({ pageId: page.pageId, layers: composePage({ storyId, version }, page) }));

const draftView = Effect.fn("authoring.draftView")(function* (
  story: typeof schema.story.$inferSelect,
  draft: { readonly id: string; readonly version: number; readonly revision: number; readonly manifest: unknown },
) {
  const manifest = yield* decodeDraft(draft.manifest);
  return {
    story: { id: story.id, slug: story.slug, title: story.title, summary: story.summary, status: story.status },
    storyVersionId: draft.id,
    version: draft.version,
    revision: draft.revision,
    draft: manifest,
    pages: draftPages(story.id, draft.version, manifest),
  };
});

/** Every page of `manifest`, an unsaved edit of the story's draft, composed for the editor's live preview. */
export const previewDraft = Effect.fn("authoring.previewDraft")(function* (
  user: SessionUser,
  storyId: string,
  manifest: StoryDraft,
) {
  const { story, draft } = yield* draftOf(user, storyId);
  return draftPages(story.id, draft.version, manifest);
});

/** The draft a story's author is working on, with every page composed. */
export const getDraft = Effect.fn("authoring.getDraft")(function* (user: SessionUser, storyId: string) {
  const { story, draft } = yield* draftOf(user, storyId);
  return yield* draftView(story, draft);
});

/** The story's published versions, newest first, and the version being drafted, if any. */
export const storyVersions = Effect.fn("authoring.storyVersions")(function* (user: SessionUser, storyId: string) {
  const owned = yield* ownedDraft(user, storyId);
  const published = yield* Database.query((db) =>
    db
      .select({ version: schema.storyVersion.version, publishedAt: schema.storyVersion.publishedAt })
      .from(schema.storyVersion)
      .where(and(eq(schema.storyVersion.storyId, storyId), isNotNull(schema.storyVersion.publishedAt)))
      .orderBy(desc(schema.storyVersion.version)),
  );
  return {
    story: {
      id: owned.story.id,
      slug: owned.story.slug,
      title: owned.story.title,
      summary: owned.story.summary,
      status: owned.story.status,
    },
    draftVersion: owned.draft?.version ?? null,
    published: published.map((row) => ({ version: row.version, publishedAt: row.publishedAt!.toISOString() })),
  };
});

/**
 * Replaces the draft's manifest, if nobody saved since `revision` (else DraftChanged). The draft only has to have the
 * book format's shape; publishing checks the rest. Returns the new revision and every page composed again.
 */
export const saveDraft = Effect.fn("authoring.saveDraft")(function* (
  user: SessionUser,
  storyId: string,
  input: {
    readonly revision: number;
    readonly draft: StoryDraft;
    readonly title: string;
    readonly summary: string;
  },
) {
  const { story, draft } = yield* draftOf(user, storyId);
  const [saved] = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.storyVersion)
        .set({
          manifest: input.draft,
          revision: sql`${schema.storyVersion.revision} + 1`,
        })
        .where(
          and(
            eq(schema.storyVersion.id, draft.id),
            eq(schema.storyVersion.revision, input.revision),
            isNull(schema.storyVersion.publishedAt),
          ),
        )
        .returning({
          id: schema.storyVersion.id,
          version: schema.storyVersion.version,
          revision: schema.storyVersion.revision,
          manifest: schema.storyVersion.manifest,
        });
      if (rows.length > 0 && (input.title !== story.title || input.summary !== story.summary)) {
        await tx
          .update(schema.story)
          .set({ title: input.title, summary: input.summary })
          .where(eq(schema.story.id, storyId));
      }
      return rows;
    }),
  );
  if (!saved) return yield* new DraftChanged();
  return yield* draftView({ ...story, title: input.title, summary: input.summary }, saved);
});

// ---- Uploads -------------------------------------------------------------------
const UPLOAD_TYPES: Record<
  string,
  { readonly contentType: string; readonly maxBytes: number; readonly looksLike: (bytes: Uint8Array) => boolean }
> = {
  ".png": {
    contentType: "image/png",
    maxBytes: 40e6,
    looksLike: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  ".jpg": {
    contentType: "image/jpeg",
    maxBytes: 40e6,
    looksLike: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  ".jpeg": {
    contentType: "image/jpeg",
    maxBytes: 40e6,
    looksLike: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  ".webp": {
    contentType: "image/webp",
    maxBytes: 40e6,
    looksLike: (b) =>
      String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP",
  },
  ".svg": {
    contentType: "image/svg+xml",
    maxBytes: 5e6,
    looksLike: (b) => new TextDecoder().decode(b.subarray(0, 4096)).includes("<svg"),
  },
  ".woff2": {
    contentType: "font/woff2",
    maxBytes: 5e6,
    looksLike: (b) => String.fromCharCode(...b.subarray(0, 4)) === "wOF2",
  },
};

const FOLDER = /^(?:fonts|style|sheets|pages\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)$/;

/**
 * Stores a file for the draft under its version's folder and returns its path for the manifest. The name ends in a
 * hash of the bytes: a version's assets never change once published, so new bytes always get a new path. Fonts must be static (D24).
 */
export const uploadDraftAsset = Effect.fn("authoring.uploadAsset")(function* (
  user: SessionUser,
  storyId: string,
  input: { readonly folder: string; readonly fileName: string; readonly body: Uint8Array },
) {
  const { draft } = yield* ownedDraft(user, storyId).pipe(Effect.flatMap((owned) => requireDraft(owned, storyId)));
  if (!FOLDER.test(input.folder))
    return yield* new InvalidInput({ message: `Can't store files in "${input.folder}".` });
  const extension = extname(input.fileName).toLowerCase();
  const type = UPLOAD_TYPES[extension];
  if (!type) return yield* new InvalidInput({ message: "Upload PNG, JPEG, WebP, or SVG art, or a WOFF2 font." });
  if ((extension === ".woff2") !== (input.folder === "fonts"))
    return yield* new InvalidInput({ message: "Fonts go with the fonts, art with the pages." });
  if (input.body.byteLength > type.maxBytes)
    return yield* new InvalidInput({ message: `${input.fileName} is larger than ${type.maxBytes / 1e6} MB.` });
  if (!type.looksLike(input.body))
    return yield* new InvalidInput({ message: `${input.fileName} isn't a ${extension.slice(1).toUpperCase()} file.` });
  if (extension === ".woff2" && isVariableFont(input.body)) {
    return yield* new InvalidInput({
      message: `${input.fileName} is a variable font, which prints badly; upload one static file per weight.`,
    });
  }
  const stem =
    input.fileName
      .slice(0, -extension.length)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "file";
  const body = input.body;
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const asset = `${input.folder}/${stem}-${hash}${extension === ".jpeg" ? ".jpg" : extension}`;
  yield* ObjectStorage.use((storage) =>
    storage.put(storyAssetKey(storyId, draft.version, asset), body, type.contentType),
  ).pipe(Effect.orDie);
  return { asset };
});

// ---- Checking and publishing -----------------------------------------------------

/** "pages › p02 › text › 1 › content: …" from a schema issue path, naming pages by their ID. */
const issueText = (draft: StoryDraft, path: ReadonlyArray<PropertyKey>, message: string) => {
  const parts = path.map((key, i) =>
    path[i - 1] === "pages" && typeof key === "number" ? (draft.pages[key]?.pageId ?? key) : key,
  );
  return parts.length > 0 ? `${parts.map(String).join(" › ")}: ${message}` : message;
};

/** Everything that stops the draft publishing: the format's checks, files, fonts, and the trim. */
const publishIssues = Effect.fn("authoring.publishIssues")(function* (
  storyId: string,
  version: number,
  draft: StoryDraft,
) {
  const decoded = yield* Effect.result(decodeStoryManifest(draft));
  if (decoded._tag === "Failure") {
    const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue);
    return [
      ...issues.map((issue) =>
        issueText(
          draft,
          (issue.path ?? []).map((segment) => (typeof segment === "object" ? segment.key : segment)),
          issue.message,
        ),
      ),
      // The trim decides the whole layout, so the author hears about it before the rest is done.
      ...printTrimIssues(draft.trim),
    ];
  }
  const manifest = decoded.success;
  const storage = yield* ObjectStorage;
  const stored = new Set(
    (yield* storage.list(storyAssetKey(storyId, version, "")).pipe(Effect.orDie)).map((object) => object.key),
  );
  const missing = manifestAssets(manifest).filter((asset) => !stored.has(storyAssetKey(storyId, version, asset)));
  const fonts = yield* Effect.forEach(
    manifest.fonts.filter((font) => stored.has(storyAssetKey(storyId, version, font.asset))),
    (font) =>
      storage.get(storyAssetKey(storyId, version, font.asset)).pipe(
        Effect.map((object) => ({ asset: font.asset, variable: isVariableFont(object.body) })),
        Effect.orDie,
      ),
  );
  return [
    ...missing.map((asset) => `${asset}: file missing; upload it again`),
    ...staticFontIssues(manifest),
    ...storyAgreementIssues(manifest.pages),
    ...printTrimIssues(manifest.trim),
    ...fonts.filter((font) => font.variable).map((font) => `${font.asset}: variable font; use static instances`),
  ];
});

/** What would stop the draft publishing now; empty when it can publish. */
export const checkDraft = Effect.fn("authoring.checkDraft")(function* (user: SessionUser, storyId: string) {
  const { draft } = yield* draftOf(user, storyId);
  return { issues: yield* publishIssues(storyId, draft.version, yield* decodeDraft(draft.manifest)) };
});

/**
 * Publishes the draft (D24: it never changes again) when every check passes, else StoryNotPublishable with the
 * issues, and the story is published if it wasn't. Files the version doesn't use are deleted, so the version's
 * folder holds what it shows.
 */
export const publishDraft = Effect.fn("authoring.publishDraft")(function* (
  user: SessionUser,
  storyId: string,
  revision: number,
) {
  const { draft } = yield* draftOf(user, storyId);
  if (draft.revision !== revision) return yield* new DraftChanged();
  const merged = yield* decodeDraft(draft.manifest);
  const issues = yield* publishIssues(storyId, draft.version, merged);
  if (issues.length > 0) return yield* new StoryNotPublishable({ issues });
  const manifest = yield* decodeStoryManifest(merged).pipe(Effect.orDie);
  const now = new Date();
  const published = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      // Publishing at the revision that was checked keeps a save made meanwhile from publishing unchecked.
      const rows = await tx
        .update(schema.storyVersion)
        .set({ manifest, publishedAt: now })
        .where(
          and(
            eq(schema.storyVersion.id, draft.id),
            eq(schema.storyVersion.revision, revision),
            isNull(schema.storyVersion.publishedAt),
          ),
        )
        .returning({ id: schema.storyVersion.id });
      if (rows.length === 0) return false;
      // An archived story stays archived: a new version reaches families only when the author restores it.
      await tx
        .update(schema.story)
        .set({
          status: sql`case when ${schema.story.status} = 'archived' then 'archived'::story_status else 'published'::story_status end`,
          publishedAt: sql`coalesce(${schema.story.publishedAt}, ${now})`,
        })
        .where(eq(schema.story.id, storyId));
      return true;
    }),
  );
  if (!published) return yield* new DraftChanged();
  // Published: removing the draft's unused uploads only tidies its folder, so a storage failure here leaves some
  // behind rather than reporting a publish that happened as failed.
  const storage = yield* ObjectStorage;
  const keep = new Set(manifestAssets(manifest).map((asset) => storyAssetKey(storyId, draft.version, asset)));
  const prefix = storyAssetKey(storyId, draft.version, "");
  for (const object of yield* storage.list(prefix).pipe(Effect.orElseSucceed(() => []))) {
    if (keep.has(object.key)) continue;
    yield* storage.delete(object.key).pipe(Effect.ignore);
  }
  return { version: draft.version };
});

/**
 * Archives a published story, or restores an archived one (D49). An archived story leaves the catalogue and its page,
 * and nobody makes a new book of it; existing books, their proofs, and every version and file stay as they are, and
 * the author keeps reading, drafting, and publishing it. Fails with InvalidInput for a story never published.
 */
export const setStoryArchived = Effect.fn("authoring.setStoryArchived")(function* (
  user: SessionUser,
  storyId: string,
  archived: boolean,
) {
  const { story } = yield* ownedDraft(user, storyId);
  if (story.status === "draft") return yield* new InvalidInput({ message: "Only a published story can be archived." });
  const status = archived ? "archived" : "published";
  yield* Database.query((db) => db.update(schema.story).set({ status }).where(eq(schema.story.id, storyId)));
  return { status };
});

/** Opens a draft of the next version, starting from the newest published one and copying its files. */
export const startNextVersion = Effect.fn("authoring.startNextVersion")(function* (user: SessionUser, storyId: string) {
  const owned = yield* ownedDraft(user, storyId);
  if (owned.draft) return { version: owned.draft.version };
  const [latest] = yield* Database.query((db) =>
    db
      .select({
        id: schema.storyVersion.id,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
      })
      .from(schema.storyVersion)
      .where(eq(schema.storyVersion.storyId, storyId))
      .orderBy(desc(schema.storyVersion.version))
      .limit(1),
  );
  if (!latest) return yield* new NotFound({ entity: "story version", id: storyId });
  const manifest = yield* decodeDraft(latest.manifest);
  const version = latest.version + 1;
  const storage = yield* ObjectStorage;
  // Copied inside the bucket, many at once: downloading and uploading each file made this take seconds.
  yield* Effect.forEach(
    manifestAssets(manifest),
    (asset) =>
      storage
        .copy(storyAssetKey(storyId, latest.version, asset), storyAssetKey(storyId, version, asset))
        .pipe(Effect.orDie),
    {
      concurrency: 16,
      discard: true,
    },
  );
  yield* Database.query((db) =>
    db
      .insert(schema.storyVersion)
      .values({ id: versionId(storyId, version), storyId, version, manifest, publishedAt: null })
      .onConflictDoNothing(),
  );
  return { version };
});
