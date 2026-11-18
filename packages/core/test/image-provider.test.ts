import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { FakeImageProvider, ImageProvider } from "../src/image-provider.ts";

const generate = (key: string, prompt = "a <cat> & \"dog\"") =>
  ImageProvider.use((p) => p.generate({ key, prompt, width: 300, height: 200 })).pipe(
    Effect.provide(FakeImageProvider),
    Effect.runSync,
  );
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("FakeImageProvider", () => {
  it("is deterministic per key, so a retried workflow step writes identical bytes", () => {
    expect(text(generate("page-1").body)).toBe(text(generate("page-1").body));
  });

  it("varies with the key", () => {
    expect(text(generate("page-1").body)).not.toBe(text(generate("page-2").body));
  });

  it("escapes the prompt into valid SVG", () => {
    const svg = text(generate("k").body);
    expect(svg).toContain("a &lt;cat&gt; &amp; &quot;dog&quot;");
    expect(svg).toContain('width="300" height="200"');
  });
});
