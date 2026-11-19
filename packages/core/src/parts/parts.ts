// Part generation and review for a story's author (D26, D30; docs/plan.md, "Authoring-time part generation"). The
// authoring UI calls these: request a part for an appearance, list and read parts while they generate, approve or
// reject them, and put the approved ones into the draft version's manifest (withApprovedParts). The `part.generate`
// task (tasks/generate-part.ts) does the generating.
import { createDb, schema } from "@lifestory/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import type { FigureLayer, Part, Rect, StoryManifest } from "../book-format/manifest.ts";
import { decodeStoryVersion, storyAssetKey } from "../book-format/index.ts";
import { Database } from "../database.ts";
import { Forbidden, InvalidInput, NotFound } from "../errors.ts";
import { Jobs } from "../jobs.ts";
import {
  type Age,
  ageOptions,
  DEFAULT_FEATURES,
  type FeaturesOption,
  HEAD_ONLY_OPTIONS,
  hasFeatures,
  lookVocabulary,
  NO_PART_OPTIONS,
  otherFeatures,
  partAxesAt,
  type PartAxis,
  sameAppearance,
} from "../looks/vocabulary.ts";
import { manifestParts, type PartDecision, type PartRequest, type PartStatus, type StoryPart } from "./contract.ts";

/** A part's files, relative to its story version's folder. */
export const partAssets = (partId: string) => ({
  base: `parts/${partId}/base.png`,
  input: `parts/${partId}/input.png`,
  /** An approved drawing of the option, for the edit to copy (referenceFor in tasks/generate-part.ts). */
  reference: `parts/${partId}/reference.png`,
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
    // Only when set, so parts requested before features existed keep their IDs.
    ...(request.features ? [request.features] : []),
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

/**
 * What each option adds: one fixed, detailed description per option, the same in every story, so separate edits
 * don't each invent the details (2026-11-19: "curly" alone drew loose waves on one pose and tight coils on another,
 * "long" with and without a fringe). Short, curly, long and glasses follow the Paper Boat front parts' prompts.
 */
const optionWords: Record<string, string> = {
  "hair:short": "short, neatly cut dark brown hair with a side parting, close at the sides and ending above the ears",
  "hair:curly": "a full, rounded head of tight, springy, small dark brown curls",
  "hair:long": "long, straight dark brown hair with a straight-cut fringe, falling past the shoulders on both sides of the neck",
  "glasses:round": "round, thin dark brown wire-frame glasses",
  "hair:buzz": "a very short dark brown buzz cut that follows the shape of the scalp",
  "hair:ponytail": "dark brown hair pulled smoothly back into one ponytail tied at the back of the head, the ponytail visible behind the head",
  "hair:braids": "dark brown hair parted in the middle into two braids that fall over the front of the shoulders",
  "hair:afro": "a full, rounded, tightly coiled dark brown afro",
  "hair:locs": "dark brown locs (dreadlocks) of even, rope-like thickness falling to the shoulders",
  "hair:bun": "dark brown hair pulled smoothly up into a round bun on top of the head",
  "facial-hair:stubble": "short, dense dark brown stubble on the jaw, chin and upper lip: tiny dark brown dots, clearly darker than the skin, like a five o'clock shadow",
  "facial-hair:moustache": "a neat, medium-thick dark brown moustache",
  "facial-hair:beard": "a full, neatly trimmed dark brown beard and moustache",
};

/** The option's description, and what the reference shows ("hair", "glasses", "facial hair"). */
const describe = (option: string) => {
  const [axis, found] = Object.entries(lookVocabulary).flatMap(([name, options]) => options.filter((o) => o.id === option).map((o) => [name, o] as const))[0] ?? [];
  const words = optionWords[option] ?? found?.label.toLowerCase() ?? option;
  const has = axis === "glasses" ? `wears ${words}` : `has ${words}`;
  return { has, thing: axis === "glasses" ? "glasses" : axis === "facialHair" ? "facial hair" : "hair" };
};

/**
 * The edit prompt for an option on a base. Hair is asked for in dark brown, which stands out against every skin
 * tone; the cut-out turns it into neutral tones for the hair-colour palette. `<ref_image_0>` is the base; with
 * `reference`, `<ref_image_1>` is an approved part of the option on its own base, which the edit copies.
 */
export const partPrompt = (age: Age, option: string, note?: string | null, reference = false) => {
  const [person, proportions] = who[age];
  const { has, thing } = describe(option);
  return [
    `<ref_image_0> exactly as it is, except the ${person} now ${has}${note ? ` (${note})` : ""}`,
    reference ? `, styled exactly like the ${thing} in <ref_image_1>, as it would look from this angle,` : ",",
    "drawn in exactly the same illustration style, line and texture as the rest of the picture.",
    `Keep exactly the same face, skin, eyebrows, expression, ${proportions}, pose, clothes, hands, props and background; change nothing else.`,
    ...(reference ? [`Use <ref_image_1> only as a reference for the ${thing}.`] : []),
  ].join(" ").replace(" ,", ",");
};

const counts = ["", "one", "two", "three", "four"];

/**
 * The prompt for a tiled edit (D44): `count` bald people side by side, each given the same option, as the
 * assessment asked (2026-11-19: all four drew visibly the same hairstyle). `<ref_image_0>` is the tiled image;
 * with `reference`, `<ref_image_1>` is an approved part to copy, as in partPrompt.
 */
export const tiledPrompt = (count: number, option: string, note?: string | null, reference = false) => {
  const { has, thing } = describe(option);
  const n = counts[count] ?? String(count);
  return [
    `<ref_image_0> holds ${n} separate portraits of bald people. Change all ${n} the same way: each person now ${has}${note ? ` (${note})` : ""}`,
    reference ? `, styled exactly like the ${thing} in <ref_image_1>, as it would look on each person,` : ",",
    "drawn as the same design on each person, in exactly the same illustration style, line and texture as the rest of the picture.",
    `Keep exactly the same faces, skin, ears, eyebrows, expressions, ages and proportions, clothes, framing and background in every portrait;`,
    `change nothing else, and keep the ${n} portraits separate.`,
    ...(reference ? [`Use <ref_image_1> only as a reference for the ${thing}.`] : []),
  ].join(" ").replace(" ,", ",");
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
    features: row.features as StoryPart["features"],
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
    // A tile's share of its tiled edit (D44).
    costUsd: generation?.costUsd == null ? null : generation.costUsd / ((row.metrics as { tile?: { of: number } } | null)?.tile?.of ?? 1),
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
  // A draft only has the format's shape until it's published (D37).
  const manifest = yield* decodeStoryVersion(row.manifest, row.publishedAt).pipe(Effect.orDie);
  return { ...row, manifest };
});

/** The figure of `slotId` on `pageId` and its base for `age`, `face`, and `features` (D40), or why there is none. */
export const findAppearance = (manifest: StoryManifest, pageId: string, slotId: string, age: Age, face: string, features?: FeaturesOption | null) => {
  const page = manifest.pages.find((candidate) => candidate.pageId === pageId);
  if (!page) return { problem: `no page "${pageId}"` } as const;
  const figures = page.illustration.layers.filter((layer): layer is FigureLayer => layer.kind === "figure" && layer.slotId === slotId);
  if (figures.length !== 1) return { problem: `page "${pageId}" has ${figures.length} figures of "${slotId}"; parts need exactly one` } as const;
  const figure = figures[0]!;
  const drawn = hasFeatures(age) ? (features ?? DEFAULT_FEATURES) : undefined;
  const base = figure.bases.find((candidate) => sameAppearance(candidate, age, face, drawn));
  if (!base) return { problem: `the "${slotId}" figure on "${pageId}" has no base for ${[age, face, drawn].filter(Boolean).join(" / ")}` } as const;
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

/** How many parts one tiled edit draws at most (D44); large figures go two to an edit (tileBases). */
export const TILES_PER_TASK = 4;

/**
 * Starts generating parts for a draft story version's appearances (D30): validates every request, records each new
 * part as `generating`, and spawns `part.generate` for the new parts in groups of one option, up to four to a tiled
 * edit (D44). Repeating a request returns the same part without generating again; another seed makes another
 * attempt. Fails with NotFound, Forbidden (not the author), or InvalidInput, before recording anything.
 */
export const requestParts = Effect.fn("parts.request")(function* (userId: string, requests: ReadonlyArray<PartRequest>) {
  const versions = new Set(requests.map((request) => request.storyVersionId));
  if (versions.size !== 1) return yield* new InvalidInput({ message: "request parts of one story version at a time" });
  const version = yield* authoredVersion(userId, requests[0]!.storyVersionId);
  if (version.publishedAt) return yield* new InvalidInput({ message: "this version is published; generate parts for a draft" });
  for (const request of requests) {
    if (request.features && !hasFeatures(request.age)) return yield* new InvalidInput({ message: `${request.age} bases have no features` });
    const appearance = findAppearance(version.manifest, request.pageId, request.slotId, request.age, request.face, request.features);
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
  }

  // Record the parts and their jobs in one transaction: a crash cannot leave generating rows without a task.
  // Only newly recorded parts are generated; overlapping/repeated requests keep their existing batch.
  const { pool } = yield* Database;
  const jobs = yield* Jobs;
  yield* Effect.promise(async () => {
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN");
      const db = createDb(connection);
      const client = jobs.client.bindToConnection(connection);
      const added: Array<PartRequest & { readonly id: string }> = [];
      // Stable insertion order also prevents overlapping batches from deadlocking on the part IDs.
      for (const request of requests.toSorted((a, b) => partIdFor(a).localeCompare(partIdFor(b)))) {
        const id = partIdFor(request);
        const inserted = await db
          .insert(schema.storyPart)
          .values({
            id,
            storyVersionId: request.storyVersionId,
            pageId: request.pageId,
            slotId: request.slotId,
            age: request.age,
            face: request.face,
            features: request.features ?? null,
            axis: request.axis,
            option: request.option,
            seed: request.seed ?? 1,
            zone: request.zone,
            note: request.note ?? null,
            prompt: partPrompt(request.age, request.option, request.note),
            requestedBy: userId,
          })
          .onConflictDoNothing()
          .returning({ id: schema.storyPart.id });
        if (inserted.length > 0) added.push({ ...request, id });
      }

      // Keep the caller's tile/reference order, independent of the lock acquisition order above.
      const order = new Map(requests.map((request, i) => [partIdFor(request), i]));
      // One option, note, and seed per edit: the tiles must ask for the same drawing.
      const groups = Map.groupBy(added.toSorted((a, b) => order.get(a.id)! - order.get(b.id)!), (request) =>
        JSON.stringify([request.axis, request.option, request.note ?? null, request.seed ?? 1]),
      );
      for (const group of groups.values()) {
        for (let first = 0; first < group.length; first += TILES_PER_TASK) {
          const partIds = group.slice(first, first + TILES_PER_TASK).map((request) => request.id);
          const { taskID } = await client.spawn("part.generate", { partIds }, { queue: Jobs.queue, idempotencyKey: `part.generate:${partIds.join(",")}` });
          await db.update(schema.storyPart).set({ taskId: taskID }).where(inArray(schema.storyPart.id, partIds));
        }
      }
      await connection.query("COMMIT");
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release();
    }
  });
  return yield* Effect.forEach(requests, (request) => getPart(userId, partIdFor(request)));
});

/**
 * `part.generate`'s params: the parts of one option to draw in one tiled edit, or one part alone; tasks spawned
 * before tiled edits (D44) name one `partId`. Here so requestParts can spawn it without importing the task.
 */
export const PartTaskParams = Schema.Union([
  Schema.Struct({ partIds: Schema.Array(Schema.String).check(Schema.isMinLength(1), Schema.isMaxLength(TILES_PER_TASK)) }),
  Schema.Struct({ partId: Schema.String }),
]);

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
      features: row.features as FeaturesOption | null,
      axis: row.axis as PartAxis,
      option: row.option,
      status: row.status,
      layers: (row.layers as ReadonlyArray<StoredLayer> | null) ?? [],
    }).map((part) => ({ partId: row.id, pageId: row.pageId, slotId: row.slotId, part })),
  );
});

const sameOption = (a: Part, b: Part) =>
  a.age === b.age && a.face === b.face && (a.features ?? DEFAULT_FEATURES) === (b.features ?? DEFAULT_FEATURES) && a.axis === b.axis && a.option === b.option;

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
          const own = mine
            .filter((entry, i) => !mine.slice(i + 1).some((later) => sameOption(later.part, entry.part) && later.partId !== entry.partId))
            .map((entry) => entry.part);
          // A head-only part is listed again for the face type's other features (D44), naming the same asset, where
          // the figure has that base and nothing of its own for the option: no generated part, no approved upload.
          const shared = own.flatMap((part): ReadonlyArray<Part> => {
            if (!HEAD_ONLY_OPTIONS.has(part.option) || !hasFeatures(part.age)) return [];
            const { features: _, ...rest } = part;
            const other = otherFeatures(part.features);
            const copy: Part = other === DEFAULT_FEATURES ? rest : { ...rest, features: other };
            const hasBase = layer.bases.some((base) => sameAppearance(base, part.age, part.face, other));
            const drawn = [...own, ...layer.parts.filter((candidate) => candidate.approved)].some((candidate) => sameOption(candidate, copy));
            return hasBase && !drawn ? [copy] : [];
          });
          const latest = [...own, ...shared];
          if (latest.length === 0) return layer;
          return { ...layer, parts: [...layer.parts.filter((part) => !latest.some((approved) => sameOption(approved, part))), ...latest] };
        }),
      },
    })),
  };
};
