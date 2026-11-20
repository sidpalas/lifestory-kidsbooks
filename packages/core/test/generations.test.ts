import type { JsonValue } from "absurd-sdk";
import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { generateImage, type GenerationRow } from "../src/generations.ts";
import { FakeImageProvider } from "../src/image-provider.ts";
import type { StoredObject } from "../src/storage.ts";
import { fakeJobs, fakeTaskContext, memoryGenerations, memoryObjectStorage } from "../src/testing.ts";

// sha256("image:task-1"), first 32 hex characters: the ID generateImage derives for task-1's image.
const task1Generation = "gen_ce1b9d91278eb3fdfe2e59ed0a4d901b";

const setup = () => ({
  objects: new Map<string, StoredObject>(),
  rows: new Map<string, GenerationRow>(),
  events: new Map<string, JsonValue>(),
});

const run = (
  taskID: string,
  { objects, rows, events }: ReturnType<typeof setup>,
  checkpoints = new Map<string, unknown>(),
) =>
  Effect.runPromiseExit(
    generateImage(fakeTaskContext(taskID, checkpoints, events), "image", {
      key: `image:${taskID}`,
      prompt: "hello",
      width: 600,
      height: 400,
      outputKey: `test/${taskID}`,
    }).pipe(
      Effect.provide(
        FakeImageProvider.pipe(
          Layer.provideMerge(Layer.mergeAll(memoryObjectStorage(objects), fakeJobs(events), memoryGenerations(rows))),
        ),
      ),
    ),
  );

describe("generateImage", () => {
  it("submits, resumes on the provider's event, and records the generation", async () => {
    const state = setup();
    const exit = await run("task-1", state);

    expect(exit).toEqual(
      Exit.succeed({ generationId: task1Generation, key: "test/task-1.svg", contentType: "image/svg+xml" }),
    );
    expect(state.objects.get("test/task-1.svg")?.body.byteLength).toBeGreaterThan(0);
    expect(state.rows.get(task1Generation)).toMatchObject({
      provider: "fake",
      status: "succeeded",
      eventName: `generation.done:${task1Generation}`,
      objectKey: "test/task-1.svg",
    });
  });

  it("converges on one object and one generation when every step reruns", async () => {
    const state = setup();
    // Fresh checkpoints each time: no step's result was stored, so the side effects repeat.
    const first = await run("task-1", state);
    const rerun = await run("task-1", state);

    expect(rerun).toEqual(first);
    expect([...state.objects.keys()]).toEqual(["test/task-1.svg"]);
    expect([...state.rows.keys()]).toEqual([task1Generation]);
  });

  it("returns the checkpointed result on a retry without generating again", async () => {
    const state = setup();
    const checkpoints = new Map<string, unknown>();
    const first = await run("task-1", state, checkpoints);
    state.objects.clear();

    expect(await run("task-1", state, checkpoints)).toEqual(first);
    expect(state.objects.size).toBe(0);
  });

  it("fails with GenerationFailed when the provider reports a failure", async () => {
    const state = setup();
    // An earlier failure callback wins over the fake provider's success: Absurd keeps the first payload.
    state.events.set(`generation.done:${task1Generation}`, {
      generationId: task1Generation,
      status: "failed",
      message: "output blocked by the content filter",
    });
    const exit = await run("task-1", state);

    expect(Exit.isFailure(exit) && JSON.stringify(exit.cause)).toContain("GenerationFailed");
    expect(state.rows.get(task1Generation)).toMatchObject({
      status: "failed",
      error: "output blocked by the content filter",
    });
  });
});
