import { schema } from "@lifestory/db";
import type { TaskContext } from "absurd-sdk";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Database } from "./database.ts";
import { GenerationFailed } from "./errors.ts";
import { generationEvent, GenerationOutcome, ImageProvider } from "./image-provider.ts";
import { step } from "./jobs.ts";

const { generation } = schema;

export type GenerationRow = typeof generation.$inferSelect;

/** The `generation` table: one row per provider job, looked up by the Modal callback route. */
export class Generations extends Context.Service<
  Generations,
  {
    /** Inserts the row unless it exists, so a rerun step keeps the first one. */
    readonly create: (row: typeof generation.$inferInsert) => Effect.Effect<void>;
    readonly get: (id: string) => Effect.Effect<Option.Option<GenerationRow>>;
    readonly update: (
      id: string,
      patch: Partial<Pick<GenerationRow, "externalId" | "status" | "error" | "usage" | "costUsd">>,
    ) => Effect.Effect<void>;
  }
>()("@lifestory/core/Generations") {
  static readonly layer = Layer.effect(
    Generations,
    Effect.gen(function* () {
      const database = yield* Database;
      const query = <A>(f: (db: typeof database.db) => Promise<A>) => Effect.promise(() => f(database.db));
      return {
        create: (row) => query((db) => db.insert(generation).values(row).onConflictDoNothing()).pipe(Effect.asVoid),
        get: (id) =>
          query((db) => db.select().from(generation).where(eq(generation.id, id))).pipe(
            Effect.map((rows) => Option.fromNullishOr(rows[0])),
          ),
        update: (id, patch) => query((db) => db.update(generation).set(patch).where(eq(generation.id, id))).pipe(Effect.asVoid),
      };
    }),
  );
}

const digest = (key: string) => createHash("sha256").update(key).digest();

export interface ImageRequest {
  /** Stable, unique key for this image, such as `page:<bookId>:<pageId>:<castKey>`. The generation ID and seed
   * derive from it, so a rerun converges on the same job; a new key (a regeneration) gets a new image. */
  readonly key: string;
  readonly prompt: string;
  readonly width: number;
  readonly height: number;
  readonly references?: ReadonlyArray<string>;
  /** Object key without extension; the provider's extension is appended. */
  readonly outputKey: string;
}

/** How long a workflow waits for a provider before failing the run (Absurd then retries it). */
const waitSeconds = 30 * 60;

/**
 * Generates one image inside a task: submits it (a step), suspends until the provider's `generation.done`
 * event, and records the outcome. `name` must be unique within the task. Safe to rerun at any point: the
 * generation ID derives from `request.key`, the row insert is idempotent, and providers dedupe submissions.
 */
export const generateImage = Effect.fn("generations.generateImage")(function* (
  ctx: TaskContext,
  name: string,
  request: ImageRequest,
) {
  const provider = yield* ImageProvider;
  const generations = yield* Generations;
  const generationId = `gen_${digest(request.key).toString("hex").slice(0, 32)}`;
  const outputKey = `${request.outputKey}.${provider.extension({ references: request.references ?? [] })}`;

  yield* step(
    ctx,
    `${name}:submit`,
    Effect.gen(function* () {
      const job = {
        generationId,
        prompt: request.prompt,
        width: request.width,
        height: request.height,
        seed: digest(request.key).readUInt32BE(0),
        references: request.references ?? [],
        outputKey,
      };
      // The row exists before the provider can call back.
      yield* generations.create({
        id: generationId,
        provider: provider.name,
        request: job,
        eventName: generationEvent(generationId),
        objectKey: outputKey,
      });
      const { externalId, usage, costUsd } = yield* provider.submit(job);
      if (externalId || usage || costUsd !== undefined) {
        yield* generations.update(generationId, {
          ...(externalId ? { externalId } : {}),
          ...(usage ? { usage } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
      }
      return { generationId };
    }),
  );

  const payload = yield* Effect.promise(() =>
    ctx.awaitEvent(generationEvent(generationId), { stepName: `${name}:wait`, timeout: waitSeconds }),
  );
  const outcome = yield* Schema.decodeUnknownEffect(GenerationOutcome)(payload).pipe(Effect.orDie);

  yield* step(
    ctx,
    `${name}:record`,
    generations
      .update(generationId, { status: outcome.status, error: outcome.status === "failed" ? outcome.message : null })
      .pipe(Effect.as(outcome.status)),
  );
  if (outcome.status === "failed") {
    return yield* new GenerationFailed({ generationId, message: outcome.message });
  }
  return { generationId, key: outputKey, contentType: outcome.contentType };
});
