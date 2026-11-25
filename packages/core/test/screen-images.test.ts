import { Effect } from "effect";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { StoredObject } from "../src/storage.ts";
import { makeScreenCopies } from "../src/tasks/screen-copies.ts";
import { fakeTaskContext, memoryObjectStorage } from "../src/testing.ts";

const image = async (width: number, height: number, format: "png" | "jpeg") => {
  const raw = sharp({ create: { width, height, channels: 4, background: { r: 200, g: 80, b: 40, alpha: 0.5 } } });
  return new Uint8Array(await (format === "png" ? raw.png() : raw.jpeg()).toBuffer());
};

const run = (objects: Map<string, StoredObject>, keys: ReadonlyArray<string>) =>
  Effect.runPromise(
    makeScreenCopies.run({ keys }, fakeTaskContext("copies-1")).pipe(Effect.provide(memoryObjectStorage(objects))),
  );

describe("makeScreenCopies", () => {
  it("stores WebP copies at each screen width beside the original, never upscaled, and reruns without remaking", async () => {
    const plate = "stories/s1/v1/pages/p01/plate.png";
    const small = "families/f1/books/b1/pages/p01/v1/0.jpg";
    const svg = "stories/s1/v1/pages/p01/hero/stock.svg";
    const objects = new Map<string, StoredObject>([
      [plate, { body: await image(3375, 2625, "png"), contentType: "image/png" }],
      [small, { body: await image(300, 450, "jpeg"), contentType: "image/jpeg" }],
      [svg, { body: new TextEncoder().encode("<svg/>"), contentType: "image/svg+xml" }],
    ]);
    await run(objects, [plate, small, svg]);

    const size = async (key: string) => {
      const object = objects.get(key)!;
      const meta = await sharp(object.body).metadata();
      return {
        type: object.contentType,
        format: meta.format,
        width: meta.width,
        height: meta.height,
        alpha: meta.hasAlpha,
      };
    };
    expect(await size(`${plate}.w512.webp`)).toEqual({
      type: "image/webp",
      format: "webp",
      width: 512,
      height: 398,
      alpha: true,
    });
    expect(await size(`${plate}.w1024.webp`)).toMatchObject({ width: 1024, height: 796, alpha: true });
    expect(await size(`${plate}.w1536.webp`)).toMatchObject({ width: 1536, height: 1195, alpha: true });
    expect(await size(`${small}.w1536.webp`)).toMatchObject({ format: "webp", width: 300, height: 450 });
    expect([...objects.keys()].filter((key) => key.startsWith(svg))).toEqual([svg]);

    // A rerun whose steps all repeat (fresh checkpoints) finds the copies and leaves them as they are.
    const before = new Map(objects);
    await run(objects, [plate, small, svg]);
    expect(objects).toEqual(before);
    for (const [key, object] of before) expect(objects.get(key)).toBe(object);
  });
});
