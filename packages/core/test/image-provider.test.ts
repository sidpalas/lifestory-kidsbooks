import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { ConfigProvider, Effect, Layer } from "effect";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ImageProvider, renderPlaceholder } from "../src/image-provider.ts";
import { OpenAIImageProvider } from "../src/providers/openai.ts";
import type { StoredObject } from "../src/storage.ts";
import { fakeJobs, memoryObjectStorage } from "../src/testing.ts";

const render = (key: string, prompt = 'a <cat> & "dog"') => renderPlaceholder({ key, prompt, width: 300, height: 200 });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("renderPlaceholder (fake provider)", () => {
  it("is deterministic per key, so a retried workflow step writes identical bytes", () => {
    expect(text(render("page-1").body)).toBe(text(render("page-1").body));
  });

  it("varies with the key", () => {
    expect(text(render("page-1").body)).not.toBe(text(render("page-2").body));
  });

  it("escapes the prompt into valid SVG", () => {
    const svg = text(render("k").body);
    expect(svg).toContain("a &lt;cat&gt; &amp; &quot;dog&quot;");
    expect(svg).toContain('width="300" height="200"');
  });
});

describe("OpenAIImageProvider", () => {
  it("sends a reference with transparency on white, so the model never sees the colour under it", async () => {
    // A stand-in for OpenAI's edit endpoint that keeps each uploaded reference and answers with a tiny image.
    const received: Array<{ type: string; bytes: Buffer }> = [];
    let background: string | null = null;
    const server = createServer(async (req, res) => {
      const chunks: Array<Buffer> = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const form = await new Request("http://local/", {
        method: "POST",
        headers: req.headers as Record<string, string>,
        body: Buffer.concat(chunks),
      }).formData();
      background = form.get("background") as string | null;
      for (const file of form.getAll("image[]") as Array<File>)
        received.push({ type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
      const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } })
        .png()
        .toBuffer();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const { port } = server.address() as AddressInfo;

    // Like the transparent sheet of 2026-11-27: a pale figure in the middle, the rest fully transparent over dark
    // grey, which is what the model drew back as a dark gradient.
    const sheet = await sharp({
      create: { width: 40, height: 20, channels: 4, background: { r: 39, g: 38, b: 34, alpha: 0 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 10, height: 10, channels: 4, background: { r: 200, g: 190, b: 180, alpha: 1 } },
          })
            .png()
            .toBuffer(),
          left: 15,
          top: 5,
        },
      ])
      .png()
      .toBuffer();
    const photo = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123456" } })
      .jpeg()
      .toBuffer();
    const objects = new Map<string, StoredObject>([
      ["sheet.png", { body: new Uint8Array(sheet), contentType: "image/png" }],
      ["photo.jpg", { body: new Uint8Array(photo), contentType: "image/jpeg" }],
    ]);
    const env = { OPENAI_API_KEY: "test", OPENAI_BASE_URL: `http://127.0.0.1:${port}` };
    try {
      await Effect.runPromise(
        ImageProvider.use((provider) =>
          provider.submit({
            generationId: "gen_1",
            prompt: "revise",
            width: 1536,
            height: 1024,
            seed: 1,
            references: ["sheet.png", "photo.jpg"],
            background: "opaque",
            outputKey: "out.png",
          }),
        ).pipe(
          Effect.provide(
            OpenAIImageProvider.pipe(
              Layer.provide([
                memoryObjectStorage(objects),
                fakeJobs(),
                ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
              ]),
            ),
          ),
        ),
      );
    } finally {
      server.close();
    }

    expect(background).toBe("opaque");
    const [sent, sentPhoto] = received;
    const { data, info } = await sharp(sent!.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    const at = (x: number, y: number) => [...data.subarray((y * 40 + x) * 3, (y * 40 + x) * 3 + 3)];
    expect(at(0, 0)).toEqual([255, 255, 255]);
    expect(at(20, 10)).toEqual([200, 190, 180]);
    // A reference without transparency goes as stored.
    expect(sentPhoto).toEqual({ type: "image/jpeg", bytes: photo });
  });
});
