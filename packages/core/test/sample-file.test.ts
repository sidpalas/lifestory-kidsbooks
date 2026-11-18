import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { FakeImageProvider } from "../src/image-provider.ts";
import type { StoredObject } from "../src/storage.ts";
import { writeSampleFile } from "../src/tasks/sample-file.ts";
import { fakeTaskContext, memoryObjectStorage } from "../src/testing.ts";

const run = (taskID: string, objects: Map<string, StoredObject>, checkpoints = new Map<string, unknown>()) =>
  Effect.runPromise(
    writeSampleFile
      .run({ label: "hello", requestedBy: "user_1" }, fakeTaskContext(taskID, checkpoints))
      .pipe(Effect.provide(Layer.merge(FakeImageProvider, memoryObjectStorage(objects)))),
  );

describe("writeSampleFile", () => {
  it("overwrites the same object when the step reruns, instead of writing a second one", async () => {
    const objects = new Map<string, StoredObject>();
    // Fresh checkpoints each time: the step's result was never stored, so the side effect repeats.
    const first = await run("task-1", objects);
    const rerun = await run("task-1", objects);

    expect([...objects.keys()]).toEqual(["samples/task-1.svg"]);
    expect(rerun).toEqual(first);
    const stored = objects.get("samples/task-1.svg")!;
    expect(first).toEqual({ key: "samples/task-1.svg", contentType: stored.contentType, bytes: stored.body.byteLength });
  });

  it("returns the checkpointed result on a retry without writing again", async () => {
    const objects = new Map<string, StoredObject>();
    const checkpoints = new Map<string, unknown>();
    const first = await run("task-1", objects, checkpoints);
    objects.clear();

    expect(await run("task-1", objects, checkpoints)).toEqual(first);
    expect(objects.size).toBe(0);
  });

  it("gives each task its own object", async () => {
    const objects = new Map<string, StoredObject>();
    await run("task-1", objects);
    await run("task-2", objects);

    expect([...objects.keys()].toSorted()).toEqual(["samples/task-1.svg", "samples/task-2.svg"]);
  });
});
