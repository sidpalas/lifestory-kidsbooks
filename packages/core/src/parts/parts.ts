// Part generation and review for a story's author (D26, D30; docs/plan.md, "Authoring-time part generation"). The
// authoring UI calls these: request a part for an appearance, list and read parts while they generate, approve or
// reject them, and put the approved ones into the draft version's manifest (withApprovedParts). The `part.generate`
// task (tasks/generate-part.ts) does the generating.
import { schema } from "@lifestory/db";
import { and, asc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import type { FigureLayer, Part, Rect, StoryManifest } from "../book-format/manifest.ts";
import { decodeStoryManifest, storyAssetKey } from "../book-format/index.ts";
import { Database } from "../database.ts";
import { Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Jobs } from "../jobs.ts";
import { type Age, ageOptions, lookVocabulary, NO_PART_OPTIONS, partAxesAt, type PartAxis } from "../looks/vocabulary.ts";
import { manifestParts, type PartDecision, type PartRequest, type PartStatus, type StoryPart } from "./contract.ts";

/** A part's files, relative to its story version's folder. */
export const partAssets = (partId: string) => ({
  base: `parts/${partId}/base.png`,
  input: `parts/${partId}/input.png`,
  /** Without extension: the provider appends its own. */
  edit: `parts/${partId}/edit`,
  part: `parts/${partId}/part.png`,
  skin: `parts/${partId}/skin.png`,
  light: `parts/${partId}/light.png`,
  dark: `parts/${partId}/dark.png`,
  sheet: `parts/${partId}/sheet.png`,
});

/**
 * The ID of a request: the same appearance, option, zone, note, and seed always name the same part, and changing any
 * of them asks for a new one.
 */
export const partIdFor = (request: PartRequest) => {
  const key = JSON.stringify([
    request.storyVersionId, request.pageId, request.slotId, request.age, request.face, request.axis, request.option,
    request.zone, request.note ?? null, request.seed ?? 1,
  ]);
  return `part_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
};

const who: Record<Age, readonly [string, string]> = {
  baby: ["bald baby", "baby age and proportions"],
  toddler: ["bald toddler", "toddler age and proportions"],
  "young-child": ["bald child", "young child age and proportions"],
  "older-child": ["bald child", "child age and proportions"],
  teen: ["bald teenager", "teenage age and proportions"],
  adult: ["bald adult", "adult age and proportions"],
  "older-adult": ["bald older adult", "older adult age and proportions"],
};

/** What each option adds, in the words that worked in the assessment (2026-11-19). */
const optionWords: Record<string, string> = {
  "hair:short": "now has short dark brown hair",
  "hair:curly": "now has curly dark brown hair",
  "hair:long": "now has long dark brown hair",
  "glasses:round": "now wears round thin black wire-frame glasses",
};

/**
 * The edit prompt for an option on a base. Hair is asked for in dark brown, which stands out against every skin
 * tone; the cut-out turns it into neutral tones for the hair-colour palette. `<ref_image_0>` is the base.
 */
export const partPrompt = (age: Age, option: string, note?: string | null) => {
  const [person, proportions] = who[age];
  const label = Object.values(lookVocabulary).flat().find((candidate) => candidate.id === option)?.label.toLowerCase() ?? option;
  const change = optionWords[option] ?? `now has ${label}`;
  return [
    `<ref_image_0> exactly as it is, except the ${person} ${change}${note ? ` (${note})` : ""},`,
    "drawn in exactly the same illustration style, line and texture as the rest of the picture.",
    `Keep exactly the same face, skin, eyebrows, expression, ${proportions}, pose, clothes, hands, props and background; change nothing else.`,
  ].join(" ");
};

type PartRow = typeof schema.storyPart.$inferSelect;

/** What `story_part.layers` holds. */
export type StoredLayer = { readonly asset: string; readonly at: Rect; readonly palette: Part["palette"] };

const partView = (row: PartRow, storyId: string, version: number, generation: { provider: string; objectKey: string; costUsd: number | null } | null): StoryPart => {
  const key = (asset: string | null) => (asset ? storyAssetKey(storyId, version, asset) : null);
  const files = partAssets(row.id);
  const ready = row.status === "pending_review" || row.status === "approved" || row.status === "rejected";
  return {
    id: row.id,
    storyVersionId: row.storyVersionId,
    pageId: row.pageId,
    slotId: row.slotId,
    age: row.age as Age,
    face: row.face as StoryPart["face"],
    axis: row.axis as PartAxis,
    option: row.option,
    seed: row.seed,
    zone: row.zone as Rect,
    note: row.note,
    prompt: row.prompt,
    status: row.status,
    layers: ((row.layers as ReadonlyArray<StoredLayer> | null) ?? []).map((layer) => ({ ...layer, key: key(layer.asset)! })),
    files: {
      edit: generation?.objectKey ?? null,
      light: ready ? key(files.light) : null,
      dark: ready ? key(files.dark) : null,
      sheet: ready ? key(files.sheet) : null,
    },
    metrics: row.metrics ?? null,
    provider: generation?.provider ?? null,
    costUsd: generation?.costUsd ?? null,
    error: row.error,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
};

/** A story version with its story, decoded, for its author only. */
const authoredVersion = Effect.fn("parts.authoredVersion")(function* (userId: string, storyVersionId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        storyId: schema.story.id,
        authorId: schema.story.authorId,
        version: schema.storyVersion.version,
        manifest: schema.storyVersion.manifest,
        publishedAt: schema.storyVersion.publishedAt,
      })
      .from(schema.storyVersion)
      .innerJoin(schema.story, eq(schema.story.id, schema.storyVersion.storyId))
      .where(eq(schema.storyVersion.id, storyVersionId)),
  );
  if (!row) return yield* new NotFound({ entity: "story version", id: storyVersionId });
  if (row.authorId !== userId) return yield* new Forbidden({ message: "only the story's author generates and reviews its parts" });
  const manifest = yield* decodeStoryManifest(row.manifest).pipe(Effect.orDie);
  return { ...row, manifest };
});

/** The figure of `slotId` on `pageId` and its base for `age` and `face`, or why there is none. */
export const findAppearance = (manifest: StoryManifest, pageId: string, slotId: string, age: Age, face: string) => {
  const page = manifest.pages.find((candidate) => candidate.pageId === pageId);
  if (!page) return { problem: `no page "${pageId}"` } as const;
  const figures = page.illustration.layers.filter((layer): layer is FigureLayer => layer.kind === "figure" && layer.slotId === slotId);
  if (figures.length !== 1) return { problem: `page "${pageId}" has ${figures.length} figures of "${slotId}"; parts need exactly one` } as const;
  const figure = figures[0]!;
  const base = figure.bases.find((candidate) => candidate.age === age && candidate.face === face);
  if (!base) return { problem: `the "${slotId}" figure on "${pageId}" has no base for ${age} / ${face}` } as const;
  return { figure, base } as const;
};

const generationOf = (generationId: string | null) =>
  generationId
    ? Database.query((db) =>
        db
          .select({ provider: schema.generation.provider, objectKey: schema.generation.objectKey, costUsd: schema.generation.costUsd })
          .from(schema.generation)
          .where(eq(schema.generation.id, generationId)),
      ).pipe(Effect.map((rows) => rows[0] ?? null))
    : Effect.succeed(null);

/**
 * Starts generating a part for a draft story version's appearance (D30): validates the request, records the part
 * as `generating`, and spawns `part.generate`. Repeating a request returns the same part without generating again;
 * another seed makes another attempt. Fails with NotFound, Forbidden (not the author), or InvalidInput.
 */
export const requestPart = Effect.fn("parts.request")(function* (userId: string, request: PartRequest) {
  const version = yield* authoredVersion(userId, request.storyVersionId);
  if (version.publishedAt) return yield* new InvalidInput({ message: "this version is published; generate parts for a draft" });
  const appearance = findAppearance(version.manifest, request.pageId, request.slotId, request.age, request.face);
  if ("problem" in appearance) return yield* new InvalidInput({ message: appearance.problem ?? "no such appearance" });
  if (!version.manifest.characterSlots.find((slot) => slot.slotId === request.slotId)?.ages.includes(request.age) && appearance.figure.age !== request.age) {
    return yield* new InvalidInput({ message: `the "${request.slotId}" role doesn't take the age ${request.age}` });
  }
  if (!partAxesAt(request.age).includes(request.axis)) {
    return yield* new InvalidInput({ message: `${ageOptions.find((age) => age.id === request.age)!.label} figures have no ${request.axis} part` });
  }
  if (!lookVocabulary[request.axis].some((option) => option.id === request.option) || NO_PART_OPTIONS.has(request.option)) {
    return yield* new InvalidInput({ message: `"${request.option}" is not a ${request.axis} option with a part` });
  }
  const [x0, y0, x1, y1] = request.zone;
  if ((x1 - x0) * (y1 - y0) < 100 * 100) return yield* new InvalidInput({ message: "the zone is too small to hold a part" });

  const id = partIdFor(request);
  const seed = request.seed ?? 1;
  yield* Database.query((db) =>
    db
      .insert(schema.storyPart)
      .values({
        id,
        storyVersionId: request.storyVersionId,
        pageId: request.pageId,
        slotId: request.slotId,
        age: request.age,
        face: request.face,
        axis: request.axis,
        option: request.option,
        seed,
        zone: request.zone,
        note: request.note ?? null,
        prompt: partPrompt(request.age, request.option, request.note),
        requestedBy: userId,
      })
      .onConflictDoNothing(),
  );
  const jobs = yield* Jobs;
  const { taskId } = yield* jobs.spawn({ name: "part.generate", params: PartTaskParams }, { partId: id }, { idempotencyKey: `part.generate:${id}` }).pipe(Effect.orDie);
  yield* Database.query((db) => db.update(schema.storyPart).set({ taskId }).where(eq(schema.storyPart.id, id)));
  return yield* getPart(userId, id);
});

/** `part.generate`'s params; here so requestPart can spawn it without importing the task. */
export const PartTaskParams = Schema.Struct({ partId: Schema.String });

/** One part, with its files and cost. A part whose task gave up after its retries reads as failed. */
export const getPart = Effect.fn("parts.get")(function* (userId: string, partId: string) {
  const [row] = yield* Database.query((db) => db.select().from(schema.storyPart).where(eq(schema.storyPart.id, partId)));
  if (!row) return yield* new NotFound({ entity: "part", id: partId });
  const version = yield* authoredVersion(userId, row.storyVersionId);
  let current = row;
  if (row.status === "generating" && row.taskId) {
    const task = yield* Jobs.use((jobs) => jobs.status(row.taskId!)).pipe(Effect.option);
    if (task._tag === "Some" && (task.value.state === "failed" || task.value.state === "cancelled")) {
      current = { ...row, status: "failed", error: row.error ?? `the generation task ${task.value.state}` };
    }
  }
  return partView(current, version.storyId, version.version, yield* generationOf(row.generationId));
});

/** Every part of a draft or published story version, oldest first. */
export const listParts = Effect.fn("parts.list")(function* (userId: string, storyVersionId: string) {
  const version = yield* authoredVersion(userId, storyVersionId);
  const rows = yield* Database.query((db) =>
    db
      .select({ part: schema.storyPart, generation: { provider: schema.generation.provider, objectKey: schema.generation.objectKey, costUsd: schema.generation.costUsd } })
      .from(schema.storyPart)
      .leftJoin(schema.generation, eq(schema.generation.id, schema.storyPart.generationId))
      .where(eq(schema.storyPart.storyVersionId, storyVersionId))
      .orderBy(asc(schema.storyPart.createdAt), asc(schema.storyPart.id)),
  );
  return rows.map(({ part, generation }) => partView(part, version.storyId, version.version, generation));
});

/**
 * The illustrator's review: approve or reject a generated part. A decision can change while the version is a draft;
 * once it's published its parts are fixed. Fails with InvalidInput for a part still generating or failed.
 */
export const reviewPart = Effect.fn("parts.review")(function* (userId: string, partId: string, decision: PartDecision) {
  const part = yield* getPart(userId, partId);
  const version = yield* authoredVersion(userId, part.storyVersionId);
  if (version.publishedAt) return yield* new InvalidInput({ message: "this version is published; its parts can't change" });
  const reviewable: ReadonlyArray<PartStatus> = ["pending_review", "approved", "rejected"];
  if (!reviewable.includes(part.status)) return yield* new InvalidInput({ message: `a ${part.status.replace("_", " ")} part can't be reviewed` });
  yield* Database.query((db) =>
    db
      .update(schema.storyPart)
      .set({ status: decision === "approve" ? "approved" : "rejected", reviewedBy: userId, reviewedAt: new Date() })
      .where(eq(schema.storyPart.id, partId)),
  );
  return yield* getPart(userId, partId);
});

/** The approved parts of a version as manifest entries, for withApprovedParts. */
export const approvedParts = Effect.fn("parts.approved")(function* (userId: string, storyVersionId: string) {
  yield* authoredVersion(userId, storyVersionId);
  const rows = yield* Database.query((db) =>
    db
      .select()
      .from(schema.storyPart)
      .where(and(eq(schema.storyPart.storyVersionId, storyVersionId), eq(schema.storyPart.status, "approved")))
      .orderBy(asc(schema.storyPart.reviewedAt), asc(schema.storyPart.id)),
  );
  return rows.flatMap((row) =>
    manifestParts({
      age: row.age as Age,
      face: row.face as Part["face"],
      axis: row.axis as PartAxis,
      option: row.option,
      status: row.status,
      layers: (row.layers as ReadonlyArray<StoredLayer> | null) ?? [],
    }).map((part) => ({ partId: row.id, pageId: row.pageId, slotId: row.slotId, part })),
  );
});

const sameOption = (a: Part, b: Part) => a.age === b.age && a.face === b.face && a.axis === b.axis && a.option === b.option;

/**
 * `manifest` with approved parts in their figures: they replace the figure's parts for the same age, face, axis,
 * and option (the placeholder or an earlier approval). When several approved parts are for one option, the most
 * recently reviewed wins, with all its layers. Pure, so the authoring UI can save
 * the result as the draft's manifest and the format's checks (vocabularyGaps, unapprovedParts) see the parts.
 */
export const withApprovedParts = (
  manifest: StoryManifest,
  entries: ReadonlyArray<{ readonly partId: string; readonly pageId: string; readonly slotId: string; readonly part: Part }>,
): StoryManifest => {
  return {
    ...manifest,
    pages: manifest.pages.map((page) => ({
      ...page,
      illustration: {
        ...page.illustration,
        layers: page.illustration.layers.map((layer) => {
          if (layer.kind !== "figure") return layer;
          const mine = entries.filter((entry) => entry.pageId === page.pageId && entry.slotId === layer.slotId);
          // Entries come per layer, grouped by part in review order: keep the last part's layers for each option.
          const latest = mine
            .filter((entry, i) => !mine.slice(i + 1).some((later) => sameOption(later.part, entry.part) && later.partId !== entry.partId))
            .map((entry) => entry.part);
          if (latest.length === 0) return layer;
          return { ...layer, parts: [...layer.parts.filter((part) => !latest.some((approved) => sameOption(approved, part))), ...latest] };
        }),
      },
    })),
  };
};
