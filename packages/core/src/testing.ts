// Test helpers for unit-testing tasks and services without Postgres or S3.
// Import from "@lifestory/core/testing" (or "../src/testing.ts" inside packages/core); never from app code.
import type { JsonValue, TaskContext } from "absurd-sdk";
import { Effect, Layer, Option } from "effect";
import { StorageError } from "./errors.ts";
import { Generations, type GenerationRow } from "./generations.ts";
import { Jobs } from "./jobs.ts";
import { ObjectStorage, type StoredObject } from "./storage.ts";

/**
 * A stand-in for Absurd's `TaskContext` (its constructor is private) that checkpoints
 * steps in `checkpoints`, the way Absurd stores them in Postgres:
 *
 * - Reuse one `checkpoints` map across runs to replay a retry after a completed step:
 *   the step returns its stored result without running again.
 * - Pass a fresh map to rerun a step whose result was never stored, as when the worker
 *   crashed after the side effect but before the checkpoint.
 *
 * `awaitEvent` returns the payload from `events` (filled by `fakeJobs`) and checkpoints it; when the event
 * hasn't been emitted it throws, where Absurd would suspend the run.
 *
 * Results go through JSON like Absurd's, so a value that doesn't survive JSON (a Date,
 * a Uint8Array) comes back changed here too. Repeated step names get `#2`, `#3` suffixes as in Absurd. Only
 * `taskID`, `headers`, `step`, and `awaitEvent` exist; extend this when a task needs more.
 */
export const fakeTaskContext = (
  taskID: string,
  checkpoints: Map<string, unknown> = new Map(),
  events: Map<string, JsonValue> = new Map(),
): TaskContext => {
  const counts = new Map<string, number>();
  const checkpointName = (name: string) => {
    const count = (counts.get(name) ?? 0) + 1;
    counts.set(name, count);
    return count === 1 ? name : `${name}#${count}`;
  };
  const context = {
    taskID,
    headers: {},
    step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const checkpoint = checkpointName(name);
      if (checkpoints.has(checkpoint)) return checkpoints.get(checkpoint) as T;
      const value = JSON.parse(JSON.stringify(await fn())) as T;
      checkpoints.set(checkpoint, value);
      return value;
    },
    awaitEvent: async (eventName: string, options?: { stepName?: string }): Promise<JsonValue> => {
      const checkpoint = checkpointName(options?.stepName ?? `$awaitEvent:${eventName}`);
      if (checkpoints.has(checkpoint)) return checkpoints.get(checkpoint) as JsonValue;
      if (!events.has(eventName)) throw new Error(`fakeTaskContext: suspended waiting for ${eventName}`);
      checkpoints.set(checkpoint, events.get(eventName)!);
      return events.get(eventName)!;
    },
  };
  return context as unknown as TaskContext;
};

/** `Jobs` whose `emit` records events in `events` (first emit wins, as in Absurd); spawning isn't supported. */
export const fakeJobs = (events: Map<string, JsonValue> = new Map()) =>
  Layer.succeed(Jobs, {
    client: undefined as never,
    spawn: () => Effect.die("fakeJobs: spawn is not supported"),
    status: () => Effect.die("fakeJobs: status is not supported"),
    emit: (eventName, payload) => Effect.sync(() => void (events.has(eventName) || events.set(eventName, payload))),
  });

/** `Generations` over a map of rows keyed by ID. */
export const memoryGenerations = (rows: Map<string, GenerationRow> = new Map()) =>
  Layer.succeed(Generations, {
    create: (row) =>
      Effect.sync(() => {
        if (rows.has(row.id)) return;
        const now = new Date();
        rows.set(row.id, {
          externalId: null,
          status: "submitted",
          error: null,
          createdAt: now,
          updatedAt: now,
          ...row,
        } as GenerationRow);
      }),
    get: (id) => Effect.sync(() => Option.fromNullishOr(rows.get(id))),
    update: (id, patch) => Effect.sync(() => void (rows.has(id) && rows.set(id, { ...rows.get(id)!, ...patch }))),
  });

/**
 * `ObjectStorage` backed by `objects`, so a test can inspect every key written.
 * `get` of a missing key fails with `StorageError`, like S3. `presign` returns a fake URL naming the key.
 * `list` reports every object as modified now.
 */
export const memoryObjectStorage = (objects: Map<string, StoredObject> = new Map()) =>
  Layer.succeed(ObjectStorage, {
    put: (key, body, contentType) => Effect.sync(() => void objects.set(key, { body, contentType })),
    get: (key) => {
      const object = objects.get(key);
      return object
        ? Effect.succeed(object)
        : Effect.fail(new StorageError({ operation: "get", key, message: "no such key" }));
    },
    list: (prefix) =>
      Effect.sync(() =>
        [...objects.keys()]
          .filter((key) => key.startsWith(prefix))
          .map((key) => ({ key, lastModified: new Date() })),
      ),
    delete: (key) => Effect.sync(() => void objects.delete(key)),
    ensureBucket: Effect.void,
    presign: (key, method) => Effect.succeed(`https://storage.test/${key}?method=${method}&signed=1`),
  });
