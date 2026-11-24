import { readFile } from "node:fs/promises";

import { Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { manifestAssets, storyAssetKey } from "../src/book-format/manifest.ts";
import { Database } from "../src/database.ts";
import type { StoredObject } from "../src/storage.ts";
import { importStoryVersion } from "../src/stories.ts";
import { memoryObjectStorage } from "../src/testing.ts";

const dir = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
const read = (asset: string) => readFile(new URL(asset, dir));
const key = (asset: string) => storyAssetKey("story_kite_day", 1, asset);

describe("importStoryVersion", () => {
  it("refuses changed files under a stored version and writes nothing, not even the missing ones", async () => {
    const manifest = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8"));
    const [changedAsset, missingAsset, ...rest] = manifestAssets(manifest);
    // The stored version: every file as the fixture has it, except one with different bytes and one never uploaded.
    const objects = new Map<string, StoredObject>();
    for (const asset of rest) objects.set(key(asset), { body: await read(asset), contentType: "image/svg+xml" });
    const oldBytes = new TextEncoder().encode("the art as first published");
    objects.set(key(changedAsset!), { body: oldBytes, contentType: "image/svg+xml" });

    const exit = await Effect.runPromiseExit(
      importStoryVersion({
        id: "story_kite_day_v1",
        storyId: "story_kite_day",
        version: 1,
        manifest,
        readAsset: async (asset) => ({ body: await read(asset), contentType: "image/svg+xml" }),
        publishedAt: new Date("2026-11-24T12:00:00Z"),
      }).pipe(
        // The refusal comes before any database access; a query would fail on this empty service.
        Effect.provide(
          Layer.mergeAll(memoryObjectStorage(objects), Layer.succeed(Database, {} as Database["Service"])),
        ),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Exit.isFailure(exit) && exit.cause)).toContain(
      `already has different files; add a new version:\n${changedAsset}`,
    );
    expect(objects.get(key(changedAsset!))?.body).toBe(oldBytes);
    expect(objects.has(key(missingAsset!))).toBe(false);
  });
});
