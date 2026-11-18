// Test helpers for unit-testing tasks and services without Postgres or S3.
// Import from "@lifestory/core/testing" (or "../src/testing.ts" inside packages/core); never from app code.
import type { TaskContext } from "absurd-sdk";
import { Effect, Layer } from "effect";
import { StorageError } from "./errors.ts";
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
 * Results go through JSON like Absurd's, so a value that doesn't survive JSON (a Date,
 * a Uint8Array) comes back changed here too. Repeated step names get `#2`, `#3` suffixes as in Absurd. Only
 * `taskID`, `headers`, and `step` exist; extend this when a task needs more.
 */
export const fakeTaskContext = (
  taskID: string,
  checkpoints: Map<string, unknown> = new Map(),
): TaskContext => {
  const counts = new Map<string, number>();
  const context = {
    taskID,
    headers: {},
    step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      const count = (counts.get(name) ?? 0) + 1;
      counts.set(name, count);
      const checkpoint = count === 1 ? name : `${name}#${count}`;
      if (checkpoints.has(checkpoint)) return checkpoints.get(checkpoint) as T;
      const value = JSON.parse(JSON.stringify(await fn())) as T;
      checkpoints.set(checkpoint, value);
      return value;
    },
  };
  return context as unknown as TaskContext;
};

/**
 * `ObjectStorage` backed by `objects`, so a test can inspect every key written.
 * `get` of a missing key fails with `StorageError`, like S3.
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
    ensureBucket: Effect.void,
  });
