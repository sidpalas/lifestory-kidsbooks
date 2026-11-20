// Story authoring (D37): an author creates a story, works on a draft of its next version (trim, fonts, text styles,
// roles, pages with their art and figures, text), and publishes it, through the same checks the seed's import runs.
// A draft is the story's unpublished story_version row; publishing sets its published_at, after which it never
// changes. Who may author: the operator, and accounts the operator grants. Generated parts (parts/parts.ts, D36) stay
// in story_part, the one record of their review: every read of the draft merges them in (`withGeneratedParts`), and
// publishing writes the merged manifest.
import { createHash, randomUUID } from "node:crypto";
import { extname } from "node:path";
import { schema } from "@lifestory/db";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { Effect, Schema, SchemaIssue } from "effect";
import type { SessionUser } from "./auth.ts";
import {
  decodeStoryDraft,
  decodeStoryManifest,
  uncoveredOptions,
  exampleCast,
  isVariableFont,
  manifestAssets,
  type Page,
  type FigureLayer,
  type StoryDraft,
  storyAssetKey,
  staticFontIssues,
  unapprovedParts,
  vocabularyGaps,
} from "./book-format/index.ts";
import type { AuthoredStory } from "./contracts.ts";
import { Database } from "./database.ts";
import { DraftChanged, Forbidden, InvalidInput, NotFound, StoryNotPublishable } from "./errors.ts";
import { composeFigure, type LayerSpec } from "./looks/compose.ts";
import type { Look } from "./looks/vocabulary.ts";
import { resolveIllustration } from "./pages.ts";
import { printTrimIssues } from "./print-ready.ts";
import { manifestParts, type PartDecision, type PartRequest, type StoryPart } from "./parts/contract.ts";
import { getPart, listParts, requestParts, reviewPart, withApprovedParts } from "./parts/parts.ts";
import { ObjectStorage } from "./storage.ts";
import { withStoredAdditions } from "./stories.ts";
import { type ArtImportRequest, ImportResult, type ImportStatus } from "./imports/contract.ts";
import { importTask } from "./imports/task.ts";
import { Jobs } from "./jobs.ts";
import { Casting, CastingOutcome } from "./imports/casting-contract.ts";
import { castingTask } from "./imports/casting-task.ts";
import { DEFAULT_FEATURES, HEAD_ONLY_OPTIONS, NO_PART_OPTIONS, hasFeatures, lookVocabulary, partAxesAt, sameAppearance } from "./looks/vocabulary.ts";
import { rasterize } from "./looks/recolour.ts";
import { byLightness, headTop } from "./parts/images.ts";
import { composeForReview } from "./imports/images.ts";

// ---- Who may author ------------------------------------------------------------

/** The operator, or an account the operator granted authoring (D37). */
export const canAuthor = Effect.fn("authoring.canAuthor")(function* (user: Pick<SessionUser, "id" | "role">) {
  if (user.role === "admin") return true;
  const rows = yield* Database.query((db) => db.select({ userId: schema.storyAuthor.userId }).from(schema.storyAuthor).where(eq(schema.storyAuthor.userId, user.id)));
  return rows.length > 0;
});

const requireAuthor = (user: Pick<SessionUser, "id" | "role">) =>
  canAuthor(user).pipe(Effect.flatMap((allowed) => (allowed ? Effect.void : Effect.fail(new Forbidden({ message: "Only authors can write stories." })))));

const requireOperator = (user: Pick<SessionUser, "role">) =>
  user.role === "admin" ? Effect.void : Effect.fail(new Forbidden({ message: "Only the operator can change who authors." }));

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
  const [found] = yield* Database.query((db) => db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email.trim().toLowerCase())));
  if (!found) return yield* new NotFound({ entity: "account", id: email });
  yield* Database.query((db) => db.insert(schema.storyAuthor).values({ userId: found.id, grantedBy: operator.id }).onConflictDoNothing());
});

/** Stops an account authoring. Its stories stay its own, published versions stay published, and drafts wait. */
export const revokeAuthor = Effect.fn("authoring.revokeAuthor")(function* (operator: SessionUser, userId: string) {
  yield* requireOperator(operator);
  yield* Database.query((db) => db.delete(schema.storyAuthor).where(eq(schema.storyAuthor.userId, userId)));
});

// ---- Stories and drafts --------------------------------------------------------

/** The illustrator's gradient maps a new draft starts from: the sample story's, which the author then adjusts. */
const starterPalettes: StoryDraft["palettes"] = {
  skin: {
    "skin:s1": [{ at: 0, colour: "#1e1612" }, { at: 0.63, colour: "#c9a088" }, { at: 0.77, colour: "#f6dcc8" }, { at: 1, colour: "#fff8f2" }],
    "skin:s2": [{ at: 0, colour: "#1e1612" }, { at: 0.63, colour: "#bf8f70" }, { at: 0.77, colour: "#eec6a8" }, { at: 1, colour: "#fff8f2" }],
    "skin:s3": [{ at: 0, colour: "#1e1612" }, { at: 0.63, colour: "#a8724f" }, { at: 0.77, colour: "#d6a07a" }, { at: 1, colour: "#fff8f2" }],
    "skin:s4": [{ at: 0, colour: "#1e1612" }, { at: 0.63, colour: "#7f4f2c" }, { at: 0.77, colour: "#b07548" }, { at: 1, colour: "#fff8f2" }],
    "skin:s5": [{ at: 0, colour: "#1e1612" }, { at: 0.63, colour: "#4a2b18" }, { at: 0.77, colour: "#6e4428" }, { at: 1, colour: "#fff8f2" }],
  },
  hairColour: {
    "hair-colour:black": [{ at: 0, colour: "#120d0a" }, { at: 0.35, colour: "#2a1d17" }, { at: 0.48, colour: "#4a3a30" }, { at: 1, colour: "#ffffff" }],
    "hair-colour:brown": [{ at: 0, colour: "#120d0a" }, { at: 0.35, colour: "#6b4226" }, { at: 0.48, colour: "#8f5d38" }, { at: 1, colour: "#ffffff" }],
    "hair-colour:blonde": [{ at: 0, colour: "#120d0a" }, { at: 0.35, colour: "#d9b45a" }, { at: 0.48, colour: "#ecd28a" }, { at: 1, colour: "#ffffff" }],
    "hair-colour:grey": [{ at: 0, colour: "#120d0a" }, { at: 0.35, colour: "#a8a8a8" }, { at: 0.48, colour: "#cfcfcf" }, { at: 1, colour: "#ffffff" }],
    "hair-colour:red": [{ at: 0, colour: "#120d0a" }, { at: 0.35, colour: "#9a3c22" }, { at: 0.48, colour: "#c25a32" }, { at: 1, colour: "#ffffff" }],
  },
};

const starterDraft = (title: string): StoryDraft => ({
  formatVersion: 2,
  // Lulu's bleed and 0.5 in safe margin, which publishing requires (D35).
  trim: { widthIn: 8.5, heightIn: 8.5, bleedIn: 0.125, safeMarginIn: 0.5 },
  fonts: [],
  // No font yet: the author uploads one and picks it, and the check says so until then.
  textStyles: {
    title: { fontFamily: "", sizePt: 30, lineHeight: 1.15, weight: 700, align: "center" },
    body: { fontFamily: "", sizePt: 17, lineHeight: 1.45, weight: 400, align: "left" },
  },
  characterSlots: [],
  palettes: starterPalettes,
  partOrder: ["facialHair", "hair", "glasses"],
  pages: [{ pageId: "p01", layout: "full-bleed-art/text-bottom", text: [{ style: "title", content: title }], illustration: { layers: [] } }],
});


const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const versionId = (storyId: string, version: number) => `${storyId}_v${version}`;

/** The newest published (or unpublished: the draft's) version number of the story in the query. */
const newestVersion = (published: boolean) =>
  sql<number | null>`(select max(${schema.storyVersion.version}) from ${schema.storyVersion} where ${schema.storyVersion.storyId} = ${schema.story.id} and ${schema.storyVersion.publishedAt} ${published ? sql`is not null` : sql`is null`})`.mapWith(
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
  return yield* Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      if (row.publishedVersion === null) return { ...row, additions: 0, missingOptions: [] } satisfies AuthoredStory;
      const [published] = yield* Database.query((db) =>
        db
          .select({ id: schema.storyVersion.id, manifest: schema.storyVersion.manifest })
          .from(schema.storyVersion)
          .where(and(eq(schema.storyVersion.storyId, row.id), eq(schema.storyVersion.version, row.publishedVersion!))),
      );
      const { manifest, additionRevision } = yield* withStoredAdditions(published!.id, published!.manifest);
      return { ...row, additions: additionRevision, missingOptions: uncoveredOptions(manifest) } satisfies AuthoredStory;
    }),
  );
});

/** A new story by `user`, in draft, with version 1 started from a one-page starter. */
export const createStory = Effect.fn("authoring.createStory")(function* (
  user: SessionUser,
  input: { readonly title: string; readonly slug: string; readonly summary: string },
) {
  yield* requireAuthor(user);
  if (!SLUG.test(input.slug)) return yield* new InvalidInput({ message: "The address may use lowercase letters, digits, and dashes." });
  const id = `story_${randomUUID()}`;
  const created = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.story)
        .values({ id, authorId: user.id, slug: input.slug, title: input.title, summary: input.summary })
        .onConflictDoNothing()
        .returning({ id: schema.story.id });
      if (!row) return false;
      await tx.insert(schema.storyVersion).values({ id: versionId(id, 1), storyId: id, version: 1, manifest: starterDraft(input.title), publishedAt: null });
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
    db.select().from(schema.story).where(and(eq(schema.story.id, storyId), eq(schema.story.authorId, user.id))),
  );
  if (!story) return yield* new NotFound({ entity: "story", id: storyId });
  const [draft] = yield* Database.query((db) =>
    db
      .select({ id: schema.storyVersion.id, version: schema.storyVersion.version, revision: schema.storyVersion.revision, manifest: schema.storyVersion.manifest, casting: schema.storyVersion.casting })
      .from(schema.storyVersion)
      .where(and(eq(schema.storyVersion.storyId, storyId), isNull(schema.storyVersion.publishedAt))),
  );
  return { story, draft: draft ?? null };
});

const requireDraft = <T extends { readonly draft: unknown }>(owned: T, storyId: string) =>
  owned.draft ? Effect.succeed(owned as T & { readonly draft: NonNullable<T["draft"]> }) : Effect.fail(new NotFound({ entity: "draft", id: storyId }));

const draftOf = (user: SessionUser, storyId: string) => ownedDraft(user, storyId).pipe(Effect.flatMap((owned) => requireDraft(owned, storyId)));

// Every stored draft was decoded on the way in, so a failure here is a bug.
const decodeDraft = (manifest: unknown) => decodeStoryDraft(manifest).pipe(Effect.orDie);

/**
 * The draft without the parts generated for it, which live in story_part (D36): a draft as stored never holds them.
 * Parts a published version carried over into this draft ("Start version n+1") are ordinary parts here and stay.
 */
const withoutGeneratedParts = (draft: StoryDraft, generated: ReadonlyArray<StoryPart>): StoryDraft => {
  const assets = new Set(generated.flatMap((part) => part.layers.map((layer) => layer.asset)));
  return {
    ...draft,
    pages: draft.pages.map((page) => ({
      ...page,
      illustration: {
        layers: page.illustration.layers.map((layer) => (layer.kind === "figure" ? { ...layer, parts: layer.parts.filter((part) => !assets.has(part.asset)) } : layer)),
      },
    })),
  };
};

/**
 * The draft with its generated parts merged in: each part waiting for review or approved replaces the figure's part
 * for the same age, face, and option, `approved` as reviewed. For one option an approved part beats one waiting,
 * and the latest wins among each. Rejected, failed, and generating parts are left out.
 */
const reviewOrder = (part: StoryPart) => (part.status === "approved" ? `1${part.reviewedAt ?? ""}` : `0${part.createdAt}`);

export const withGeneratedParts = (draft: StoryDraft, parts: ReadonlyArray<StoryPart>): StoryDraft => {
  const entries = parts
    .filter((part) => part.status === "approved" || part.status === "pending_review")
    .toSorted((a, b) => reviewOrder(a).localeCompare(reviewOrder(b)))
    .flatMap((part) => manifestParts(part).map((entry) => ({ partId: part.id, pageId: part.pageId, slotId: part.slotId, part: entry })));
  return withApprovedParts(draft, entries);
};

/**
 * A draft page's illustration for its slots' example characters, as storage keys. Unlike a published version, a draft
 * may lack a base, a part, or a palette for the example's look: that figure is left out (its box guide still shows),
 * and so is a figure whose files can't be recoloured, so one bad upload doesn't stop the editor.
 */
const draftPagePreview = (storyId: string, version: number, draft: StoryDraft, page: Page, looks: Readonly<Record<string, Look>> = {}) => {
  const cast = exampleCast(draft);
  const groups = page.illustration.layers.map((layer): ReadonlyArray<LayerSpec> => {
    if (layer.kind === "art") return [{ asset: layer.asset, rect: [0, 0, 1000, 1000], recolour: [] }];
    const member = cast[layer.slotId];
    if (!member) return [];
    try {
      return composeFigure(draft.palettes, draft.partOrder, layer, looks[layer.slotId] ?? member.look);
    } catch {
      return [];
    }
  });
  return Effect.forEach(groups, (group) =>
    resolveIllustration(storyId, version, group).pipe(Effect.catchCause(() => Effect.succeed([]))),
  ).pipe(Effect.map((resolved) => ({ pageId: page.pageId, layers: resolved.flat() })));
};

const draftView = Effect.fn("authoring.draftView")(function* (
  user: SessionUser,
  story: typeof schema.story.$inferSelect,
  draft: { readonly id: string; readonly version: number; readonly revision: number; readonly manifest: unknown; readonly casting?: unknown },
) {
  const manifest = yield* decodeDraft(draft.manifest);
  const parts = yield* listParts(user.id, draft.id).pipe(Effect.orDie);
  const merged = withGeneratedParts(manifest, parts);
  const pages = yield* Effect.forEach(merged.pages, (page) => draftPagePreview(story.id, draft.version, merged, page), { concurrency: 2 });
  return {
    story: { id: story.id, slug: story.slug, title: story.title, summary: story.summary, status: story.status },
    storyVersionId: draft.id,
    version: draft.version,
    revision: draft.revision,
    draft: manifest,
    casting: Schema.decodeUnknownSync(Casting)(draft.casting ?? []),
    parts,
    pages,
  };
});

/**
 * Every page of `manifest`, an unsaved edit of the story's draft, composed with its generated parts, for the editor's
 * live preview; nothing is saved. Roles are drawn with `looks` where given ("preview as" a family member, never
 * stored), else as their examples. A figure that can't draw its look is left out.
 */
export const previewDraft = Effect.fn("authoring.previewDraft")(function* (
  user: SessionUser,
  storyId: string,
  manifest: StoryDraft,
  looks: Readonly<Record<string, Look>> = {},
  candidateId?: string,
) {
  const { story, draft } = yield* draftOf(user, storyId);
  const parts = yield* listParts(user.id, draft.id).pipe(Effect.orDie);
  const candidate = parts.find((p) => p.id === candidateId);
  // Context review must show the selected take, not an older approved take of the same option.
  const candidates = candidate ? parts.filter((p) => p.id === candidate.id || p.pageId !== candidate.pageId || p.slotId !== candidate.slotId || p.option !== candidate.option || !sameAppearance({ ...p, features: p.features ?? undefined }, candidate.age, candidate.face, candidate.features ?? DEFAULT_FEATURES)) : parts;
  const merged = withGeneratedParts(withoutGeneratedParts(manifest, parts), candidates.map((p) => p.id === candidate?.id ? { ...p, status: "pending_review" as const } : p));
  return yield* Effect.forEach(merged.pages, (page) => draftPagePreview(story.id, draft.version, merged, page, looks), { concurrency: 2 });
});

/** The draft a story's author is working on, with its generated parts and every page composed for the slots' examples. */
export const getDraft = Effect.fn("authoring.getDraft")(function* (user: SessionUser, storyId: string) {
  const { story, draft } = yield* draftOf(user, storyId);
  return yield* draftView(user, story, draft);
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
    story: { id: owned.story.id, slug: owned.story.slug, title: owned.story.title, summary: owned.story.summary, status: owned.story.status },
    draftVersion: owned.draft?.version ?? null,
    published: published.map((row) => ({ version: row.version, publishedAt: row.publishedAt!.toISOString() })),
  };
});

/**
 * Replaces the draft's manifest, if nobody saved since `revision` (else DraftChanged). The draft only has to have the
 * book format's shape; publishing checks the rest. Generated parts are dropped: they live in story_part. Returns the
 * new revision and every page composed again.
 */
export const saveDraft = Effect.fn("authoring.saveDraft")(function* (
  user: SessionUser,
  storyId: string,
  input: { readonly revision: number; readonly draft: StoryDraft; readonly title: string; readonly summary: string; readonly casting?: Casting },
) {
  const { story, draft } = yield* draftOf(user, storyId);
  const generated = yield* listParts(user.id, draft.id).pipe(Effect.orDie);
  const [saved] = yield* Database.query((db) =>
    db.transaction(async (tx) => {
      const rows = await tx
        .update(schema.storyVersion)
        .set({ manifest: withoutGeneratedParts(input.draft, generated), ...(input.casting ? { casting: input.casting } : {}), revision: sql`${schema.storyVersion.revision} + 1` })
        .where(and(eq(schema.storyVersion.id, draft.id), eq(schema.storyVersion.revision, input.revision), isNull(schema.storyVersion.publishedAt)))
        .returning({ id: schema.storyVersion.id, version: schema.storyVersion.version, revision: schema.storyVersion.revision, manifest: schema.storyVersion.manifest, casting: schema.storyVersion.casting });
      if (rows.length > 0 && (input.title !== story.title || input.summary !== story.summary)) {
        await tx.update(schema.story).set({ title: input.title, summary: input.summary }).where(eq(schema.story.id, storyId));
      }
      return rows;
    }),
  );
  if (!saved) return yield* new DraftChanged();
  return yield* draftView(user, { ...story, title: input.title, summary: input.summary }, saved);
});

// ---- Generated parts (D36) --------------------------------------------------------------

/**
 * Asks the part pipeline for options of figure appearances on the saved draft (requestParts): each the figure of
 * `slotId` on `pageId`, from its base at `age` and `face`. The same request returns the same part; another seed is
 * another attempt.
 */
export const requestDraftParts = Effect.fn("authoring.requestParts")(function* (
  user: SessionUser,
  storyId: string,
  requests: ReadonlyArray<Omit<PartRequest, "storyVersionId">>,
) {
  const { draft } = yield* draftOf(user, storyId);
  return yield* requestParts(
    user.id,
    requests.map((request) => ({ ...request, storyVersionId: draft.id })),
  );
});

/** The author's review of a generated part of the draft: approve or reject (reviewPart). */
export const reviewDraftPart = Effect.fn("authoring.reviewPart")(function* (user: SessionUser, storyId: string, partId: string, decision: PartDecision, reason?: string) {
  const { draft } = yield* draftOf(user, storyId);
  const part = yield* getPart(user.id, partId);
  if (part.storyVersionId !== draft.id) return yield* new NotFound({ entity: "part", id: partId });
  return yield* reviewPart(user.id, partId, decision, reason);
});

/** The draft's generated parts, for watching them generate. */
export const listDraftParts = Effect.fn("authoring.listParts")(function* (user: SessionUser, storyId: string) {
  const { draft } = yield* draftOf(user, storyId);
  return yield* listParts(user.id, draft.id);
});

/** A saved-draft plan, before any paid edits. Only existing, author-accepted bases are used. */
export const draftPartPlan = Effect.fn("authoring.partPlan")(function* (user: SessionUser, storyId: string) {
  const { draft } = yield* draftOf(user, storyId);
  const manifest = yield* decodeDraft(draft.manifest);
  const generated = yield* listParts(user.id, draft.id).pipe(Effect.orDie);
  const merged = withGeneratedParts(manifest, generated);
  const requests: Array<Omit<PartRequest, "storyVersionId">> = [];
  const blocked: string[] = [];
  for (const page of merged.pages) for (const figure of page.illustration.layers) {
    if (figure.kind !== "figure" || figure.showsHead === false) continue;
    if (page.illustration.layers.filter((f) => f.kind === "figure" && f.slotId === figure.slotId).length !== 1) { blocked.push(`${page.pageId}/${figure.slotId}: repeated role; use Details.`); continue; }
    for (const base of figure.bases) {
      const features = hasFeatures(base.age) ? base.features ?? DEFAULT_FEATURES : undefined;
      const mask = yield* ObjectStorage.use((s) => s.get(storyAssetKey(storyId, draft.version, base.skinMask))).pipe(Effect.orDie);
      const top = yield* Effect.promise(async () => {
        const meta = await (await rasterize(mask.body)).metadata();
        const y = await headTop(mask.body, meta.width!, meta.height!, [0, 0, meta.width!, meta.height!]);
        return Math.round(y * 1000 / meta.height!);
      });
      for (const axis of partAxesAt(base.age)) for (const option of lookVocabulary[axis]) {
        if (NO_PART_OPTIONS.has(option.id)) continue;
        if (figure.parts.some((p) => sameAppearance(p, base.age, base.face, features) && p.axis === axis && p.option === option.id)) continue;
        if (base.features === "features:soft" && HEAD_ONLY_OPTIONS.has(option.id) && figure.bases.some((b) => sameAppearance(b, base.age, base.face, DEFAULT_FEATURES))) continue;
        const attempts = generated.filter((p) => p.pageId === page.pageId && p.slotId === figure.slotId && sameAppearance({ ...p, features: p.features ?? undefined }, base.age, base.face, features) && p.option === option.id);
        if (attempts.some((p) => p.status === "generating") || attempts.at(-1)?.status === "rejected") continue;
        requests.push({ pageId: page.pageId, slotId: figure.slotId, age: base.age, face: base.face,
          ...(hasFeatures(base.age) ? { features: base.features ?? DEFAULT_FEATURES } : {}), axis, option: option.id,
          zone: [0, Math.max(0, top - 150), 1000, Math.min(1000, top + (HEAD_ONLY_OPTIONS.has(option.id) ? 450 : 850))],
          seed: Math.max(0, ...attempts.map((p) => p.seed)) + 1,
        });
      }
    }
    if (!figure.bases.length) blocked.push(`${page.pageId}/${figure.slotId}: approve an extracted base first.`);
  }
  return { requests, blocked, estimateUsd: Math.round(requests.length * 0.049 * 100) / 100 };
});

/** Uploaded parts get the same light/dark review as generated ones, cached under the story version. */
export const draftUploadReview = Effect.fn("authoring.uploadReview")(function* (user: SessionUser, storyId: string, pageId: string, slotId: string, asset: string) {
  const { draft } = yield* draftOf(user, storyId);
  const manifest = yield* decodeDraft(draft.manifest);
  const figure = manifest.pages.find((p) => p.pageId === pageId)?.illustration.layers.find((f): f is FigureLayer => f.kind === "figure" && f.slotId === slotId);
  const part = figure?.parts.find((p) => p.asset === asset);
  const base = figure?.bases.find((b) => part && sameAppearance(b, part.age, part.face, hasFeatures(part.age) ? part.features ?? DEFAULT_FEATURES : undefined));
  if (!figure || !part || !base) return yield* new NotFound({ entity: "uploaded part", id: asset });
  const parts = figure.parts.filter((p) => sameAppearance(p, part.age, part.face, hasFeatures(part.age) ? part.features ?? DEFAULT_FEATURES : undefined) && p.axis === part.axis && p.option === part.option);
  const hash = createHash("sha256").update(JSON.stringify(["transparent-v1", base, parts, manifest.palettes])).digest("hex").slice(0, 24);
  const keys = { light: storyAssetKey(storyId, draft.version, `parts/upload-${hash}/light.png`), dark: storyAssetKey(storyId, draft.version, `parts/upload-${hash}/dark.png`) };
  const storage = yield* ObjectStorage;
  const cached = yield* storage.get(keys.dark).pipe(Effect.option);
  if (cached._tag === "Some") return keys;
  const read = (path: string) => storage.get(storyAssetKey(storyId, draft.version, path)).pipe(Effect.map((o) => o.body), Effect.orDie);
  const png = yield* read(base.asset);
  const shape = yield* Effect.promise(async () => (await rasterize(png)).metadata());
  const w = Math.min(500, shape.width!); const h = Math.round(shape.height! * w / shape.width!);
  const inputs = { base: png, skinMask: yield* read(base.skinMask), overlay: base.overlay ? yield* read(base.overlay) : null,
    occluder: base.occluder ? { asset: yield* read(base.occluder.asset), ...(base.occluder.skinMask ? { skinMask: yield* read(base.occluder.skinMask) } : {}) } : null,
    parts: yield* Effect.forEach(parts, (p) => read(p.asset).pipe(Effect.map((bytes) => ({ png: bytes, at: p.at, palette: p.palette })))),
  };
  const skins = byLightness(manifest.palettes.skin); const hairs = byLightness(manifest.palettes.hairColour);
  for (const [side, skin, hair] of [["light", skins[0]!, hairs.at(-1)!], ["dark", skins.at(-1)!, hairs[0]!]] as const) {
    const bytes = yield* Effect.promise(() => composeForReview(inputs, { skin: manifest.palettes.skin[skin]!, hair: manifest.palettes.hairColour[hair]! }, w, h));
    yield* storage.put(keys[side], bytes, "image/png").pipe(Effect.orDie);
  }
  return keys;
});

// ---- Uploads -------------------------------------------------------------------
const UPLOAD_TYPES: Record<string, { readonly contentType: string; readonly maxBytes: number; readonly looksLike: (bytes: Uint8Array) => boolean }> = {
  ".png": { contentType: "image/png", maxBytes: 40e6, looksLike: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  ".jpg": { contentType: "image/jpeg", maxBytes: 40e6, looksLike: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".jpeg": { contentType: "image/jpeg", maxBytes: 40e6, looksLike: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ".webp": { contentType: "image/webp", maxBytes: 40e6, looksLike: (b) => String.fromCharCode(...b.subarray(0, 4)) === "RIFF" && String.fromCharCode(...b.subarray(8, 12)) === "WEBP" },
  ".svg": { contentType: "image/svg+xml", maxBytes: 5e6, looksLike: (b) => new TextDecoder().decode(b.subarray(0, 4096)).includes("<svg") },
  ".woff2": { contentType: "font/woff2", maxBytes: 5e6, looksLike: (b) => String.fromCharCode(...b.subarray(0, 4)) === "wOF2" },
};

const FOLDER = /^(?:fonts|pages\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?)$/;

/**
 * Stores a file for the draft under its version's folder and returns its path for the manifest. The name ends in a
 * hash of the bytes: a version's assets never change once published, and the recolour cache keys on the path
 * (pages.ts), so new bytes always get a new path. Fonts must be static (D24).
 */
export const uploadDraftAsset = Effect.fn("authoring.uploadAsset")(function* (
  user: SessionUser,
  storyId: string,
  input: { readonly folder: string; readonly fileName: string; readonly body: Uint8Array },
) {
  const { draft } = yield* ownedDraft(user, storyId).pipe(Effect.flatMap((owned) => requireDraft(owned, storyId)));
  if (!FOLDER.test(input.folder)) return yield* new InvalidInput({ message: `Can't store files in "${input.folder}".` });
  const extension = extname(input.fileName).toLowerCase();
  const type = UPLOAD_TYPES[extension];
  if (!type) return yield* new InvalidInput({ message: "Upload PNG, JPEG, WebP, or SVG art, or a WOFF2 font." });
  if ((extension === ".woff2") !== (input.folder === "fonts")) return yield* new InvalidInput({ message: "Fonts go with the fonts, art with the pages." });
  if (input.body.byteLength > type.maxBytes) return yield* new InvalidInput({ message: `${input.fileName} is larger than ${type.maxBytes / 1e6} MB.` });
  if (!type.looksLike(input.body)) return yield* new InvalidInput({ message: `${input.fileName} isn't a ${extension.slice(1).toUpperCase()} file.` });
  if (extension === ".woff2" && isVariableFont(input.body)) {
    return yield* new InvalidInput({ message: `${input.fileName} is a variable font, which prints badly; upload one static file per weight.` });
  }
  const stem = input.fileName.slice(0, -extension.length).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "file";
  // Browser image display honors EXIF orientation; the extraction rasterizer does not. Casting uses one
  // oriented, metadata-free source so detected boxes, the browser's boxes and extraction share coordinates.
  const castingSource = input.folder.endsWith("/casting");
  const body = castingSource ? yield* Effect.tryPromise({ try: async () => (await rasterize(input.body)).rotate().png().toBuffer(), catch: () => new InvalidInput({ message: "Couldn't read this page image. Upload a PNG, JPEG or WebP image." }) }) : input.body;
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const asset = `${input.folder}/${stem}-${hash}${castingSource ? ".png" : extension === ".jpeg" ? ".jpg" : extension}`;
  yield* ObjectStorage.use((storage) => storage.put(storyAssetKey(storyId, draft.version, asset), body, castingSource ? "image/png" : type.contentType));
  return { asset };
});


// ---- Checking and publishing -----------------------------------------------------

/** "pages › p02 › text › 1 › content: …" from a schema issue path, naming pages by their ID. */
const issueText = (draft: StoryDraft, path: ReadonlyArray<PropertyKey>, message: string) => {
  const parts = path.map((key, i) => (path[i - 1] === "pages" && typeof key === "number" ? (draft.pages[key]?.pageId ?? key) : key));
  return parts.length > 0 ? `${parts.map(String).join(" › ")}: ${message}` : message;
};

/** Everything that stops the draft publishing: the format's checks, approvals, vocabulary gaps, files, and fonts. */
const publishIssues = Effect.fn("authoring.publishIssues")(function* (storyId: string, version: number, draft: StoryDraft) {
  const decoded = yield* Effect.result(decodeStoryManifest(draft));
  if (decoded._tag === "Failure") {
    const { issues } = SchemaIssue.makeFormatterStandardSchemaV1()(decoded.failure.issue);
    return issues.map((issue) => issueText(draft, (issue.path ?? []).map((segment) => (typeof segment === "object" ? segment.key : segment)), issue.message));
  }
  const manifest = decoded.success;
  const storage = yield* ObjectStorage;
  const stored = new Set((yield* storage.list(storyAssetKey(storyId, version, ""))).map((object) => object.key));
  const missing = manifestAssets(manifest).filter((asset) => !stored.has(storyAssetKey(storyId, version, asset)));
  const fonts = yield* Effect.forEach(
    manifest.fonts.filter((font) => stored.has(storyAssetKey(storyId, version, font.asset))),
    (font) => storage.get(storyAssetKey(storyId, version, font.asset)).pipe(Effect.map((object) => ({ asset: font.asset, variable: isVariableFont(object.body) }))),
  );
  return [
    ...missing.map((asset) => `${asset}: file missing; upload it again`),
    ...unapprovedParts(manifest).map((part) => `not approved: ${part}`),
    ...vocabularyGaps(manifest),
    ...staticFontIssues(manifest),
    ...printTrimIssues(manifest.trim),
    ...fonts.filter((font) => font.variable).map((font) => `${font.asset}: variable font; use static instances`),
  ];
});

/** The draft as it would publish: stored, with its generated parts merged in. */
const mergedDraft = Effect.fn("authoring.mergedDraft")(function* (user: SessionUser, draft: { readonly id: string; readonly manifest: unknown }) {
  return withGeneratedParts(yield* decodeDraft(draft.manifest), yield* listParts(user.id, draft.id).pipe(Effect.orDie));
});

/** What would stop the draft publishing now; empty when it can publish. */
export const checkDraft = Effect.fn("authoring.checkDraft")(function* (user: SessionUser, storyId: string) {
  const { draft } = yield* draftOf(user, storyId);
  return { issues: yield* publishIssues(storyId, draft.version, yield* mergedDraft(user, draft)) };
});

/**
 * Publishes the draft (D24: it never changes again) when every check passes, else StoryNotPublishable with the
 * issues: its manifest becomes the draft with its generated parts merged in, and the story is published if it wasn't.
 * Files the version doesn't use are deleted, except the recolour cache and the generated parts' files (their review
 * record), so the version's folder holds what it shows.
 */
export const publishDraft = Effect.fn("authoring.publishDraft")(function* (user: SessionUser, storyId: string, revision: number) {
  const { draft } = yield* draftOf(user, storyId);
  if (draft.revision !== revision) return yield* new DraftChanged();
  const merged = yield* mergedDraft(user, draft);
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
        .where(and(eq(schema.storyVersion.id, draft.id), eq(schema.storyVersion.revision, revision), isNull(schema.storyVersion.publishedAt)))
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
  const storage = yield* ObjectStorage;
  const keep = new Set(manifestAssets(manifest).map((asset) => storyAssetKey(storyId, draft.version, asset)));
  const prefix = storyAssetKey(storyId, draft.version, "");
  for (const object of yield* storage.list(prefix)) {
    if (keep.has(object.key) || object.key.startsWith(`${prefix}recoloured/`) || object.key.startsWith(`${prefix}parts/`)) continue;
    yield* storage.delete(object.key);
  }
  return { version: draft.version };
});

/**
 * Archives a published story, or restores an archived one (D49). An archived story leaves the catalogue and its page,
 * and nobody makes a new book of it; existing books, their proofs, and every version and file stay as they are, and
 * the author keeps reading, drafting, and publishing it. Fails with InvalidInput for a story never published.
 */
export const setStoryArchived = Effect.fn("authoring.setStoryArchived")(function* (user: SessionUser, storyId: string, archived: boolean) {
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
      .select({ id: schema.storyVersion.id, version: schema.storyVersion.version, manifest: schema.storyVersion.manifest })
      .from(schema.storyVersion)
      .where(eq(schema.storyVersion.storyId, storyId))
      .orderBy(desc(schema.storyVersion.version))
      .limit(1),
  );
  if (!latest) return yield* new NotFound({ entity: "story version", id: storyId });
  // The next version starts from what books draw now: the published one with its additions (D41) folded in.
  const { manifest } = yield* withStoredAdditions(latest.id, latest.manifest);
  const version = latest.version + 1;
  const storage = yield* ObjectStorage;
  // Copied inside the bucket, many at once: downloading and uploading each file made this take seconds.
  yield* Effect.forEach(manifestAssets(manifest), (asset) => storage.copy(storyAssetKey(storyId, latest.version, asset), storyAssetKey(storyId, version, asset)), {
    concurrency: 16,
    discard: true,
  });
  // The parts that were generated for the published version are in this one as ordinary approved parts.
  yield* Database.query((db) =>
    db.insert(schema.storyVersion).values({ id: versionId(storyId, version), storyId, version, manifest, publishedAt: null }).onConflictDoNothing(),
  );
  return { version };
});

// ---- Importing art made outside the app ------------------------------------------------------

const IMPORT_ASSET = /^pages\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)?\/[a-z0-9-]+\.(?:png|jpg|webp)$/;
const ID = /^[a-z][a-z0-9-]*$/;

/**
 * Starts importing art for one page and role of the draft (`page.import`): a layered file's layers or a flat page,
 * already uploaded to the draft's folder, or another face type drawn from an earlier import. The same request
 * returns the same task; another seed is another attempt.
 */
export const requestArtImport = Effect.fn("authoring.requestImport")(function* (user: SessionUser, storyId: string, request: ArtImportRequest) {
  const { draft } = yield* draftOf(user, storyId);
  if (!ID.test(request.pageId) || !ID.test(request.slotId)) return yield* new InvalidInput({ message: "Pick a page and a role." });
  const assets =
    request.kind === "derive" ? [request.from] : request.source.kind === "flat" ? [request.source.asset, ...[request.source.removed, request.source.plate].filter((s): s is string => !!s)] : request.source.layers.map((layer) => layer.asset);
  if (assets.some((asset) => !IMPORT_ASSET.test(asset))) return yield* new InvalidInput({ message: "Upload the art to this draft first." });
  const key = createHash("sha256").update(JSON.stringify([draft.id, request])).digest("hex").slice(0, 32);
  const { taskId } = yield* Jobs.use((jobs) =>
    jobs.spawn(importTask, { storyId, version: draft.version, request }, { idempotencyKey: `page.import:${key}` }),
  ).pipe(Effect.orDie);
  return { taskId };
});

const ImportOutcome = Schema.Union([Schema.Struct({ result: ImportResult }), Schema.Struct({ storyId: Schema.String, error: Schema.String })]);

/** How an import is going: working, done with its result for the author to review, or failed with why. */
export const artImportStatus = Effect.fn("authoring.importStatus")(function* (user: SessionUser, storyId: string, taskId: string) {
  yield* draftOf(user, storyId);
  const task = yield* Jobs.use((jobs) => jobs.status(taskId)).pipe(Effect.mapError(() => new NotFound({ entity: "import", id: taskId })));
  if (task.state === "failed" || task.state === "cancelled") return { taskId, state: "failed", result: null, error: "The import stopped; try again." } satisfies ImportStatus;
  if (task.state !== "completed") return { taskId, state: "working", result: null, error: null } satisfies ImportStatus;
  const outcome = yield* Schema.decodeUnknownEffect(ImportOutcome)(task.result).pipe(Effect.orDie);
  const owner = "result" in outcome ? outcome.result.storyId : outcome.storyId;
  if (owner !== storyId) return yield* new NotFound({ entity: "import", id: taskId });
  return "result" in outcome
    ? ({ taskId, state: "done", result: outcome.result, error: null } satisfies ImportStatus)
    : ({ taskId, state: "failed", result: null, error: outcome.error } satisfies ImportStatus);
});

/** Runs only saved casting, so editing a box requires another save and approval before extraction. */
export const requestCasting = Effect.fn("authoring.casting")(function* (user: SessionUser, storyId: string, pageId: string, mode: "detect" | "extract", requestId: string) {
  const { draft } = yield* draftOf(user, storyId);
  const casting = Schema.decodeUnknownSync(Casting)(draft.casting);
  const page = casting.find((p) => p.pageId === pageId);
  const manifest = yield* decodeDraft(draft.manifest);
  if (!page || !ID.test(page.pageId) || !manifest.pages.some((p) => p.pageId === pageId) || !IMPORT_ASSET.test(page.asset)) return yield* new InvalidInput({ message: "Save an uploaded source page first." });
  if (!manifest.characterSlots.length) return yield* new InvalidInput({ message: "Add the story's roles first." });
  if (mode === "extract") {
    const selected = page.figures.filter((f) => !f.ignored);
    if (!page.approved || !selected.length) return yield* new InvalidInput({ message: "Approve casting before extracting characters." });
    if (new Set(selected.map((f) => f.slotId)).size !== selected.length) return yield* new InvalidInput({ message: "A role can appear once per page in this slice. Ignore duplicates or use the manual editor." });
    for (const f of selected) {
      const role = manifest.characterSlots.find((r) => r.slotId === f.slotId);
      if (!role || !role.ages.includes(f.age) || !f.description.trim()) return yield* new InvalidInput({ message: "Assign every selected character a role, an accepted age, and a description." });
      if (f.hair !== null && (f.head[0] < f.box[0] || f.head[1] < f.box[1] || f.head[2] > f.box[2] || f.head[3] > f.box[3])) return yield* new InvalidInput({ message: "Keep each head box inside its whole-figure box before extraction." });
      if (selected.some((other) => other.id !== f.id && Math.min(f.box[2], other.box[2]) > Math.max(f.box[0], other.box[0]) && Math.min(f.box[3], other.box[3]) > Math.max(f.box[1], other.box[1]))) return yield* new InvalidInput({ message: "Overlapping figure boxes need the manual layered import in Pages in this slice. Correct the boxes if the people are separate." });
    }
  }
  const hash = createHash("sha256").update(JSON.stringify([draft.id, page.asset, page.figures, manifest.characterSlots, mode, requestId])).digest("hex");
  return yield* Jobs.use((jobs) => jobs.spawn(castingTask, { storyId, version: draft.version, page, roles: manifest.characterSlots, mode }, { idempotencyKey: `casting:${hash}` })).pipe(Effect.orDie);
});

export const castingStatus = Effect.fn("authoring.castingStatus")(function* (user: SessionUser, storyId: string, taskId: string) {
  yield* draftOf(user, storyId);
  const task = yield* Jobs.use((j) => j.status(taskId)).pipe(Effect.mapError(() => new NotFound({ entity: "casting", id: taskId })));
  if (task.state === "failed" || task.state === "cancelled") return { state: "failed" as const, outcome: null, error: "Casting stopped. You can correct boxes manually or try again." };
  if (task.state !== "completed") return { state: "working" as const, outcome: null, error: null };
  const outcome = yield* Schema.decodeUnknownEffect(CastingOutcome)(task.result).pipe(Effect.orDie);
  if (outcome.storyId !== storyId) return yield* new NotFound({ entity: "casting", id: taskId });
  return { state: outcome.error ? "failed" as const : "done" as const, outcome, error: outcome.error };
});
