import { describe, expect, it } from "vitest";

import { renderPlaceholder } from "../src/image-provider.ts";
import { isPhotoKey } from "../src/providers/openai.ts";

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

describe("isPhotoKey (the ZDR guard, D56)", () => {
  it("names a family's uploaded photos, and nothing else under the book", () => {
    expect(isPhotoKey("families/f1/books/b1/photos/hero/up1.jpg")).toBe(true);
    expect(isPhotoKey("families/f1/books/b1/likeness/hero-sheet.png")).toBe(false);
    expect(isPhotoKey("families/f1/proofs/photos/p.pdf")).toBe(false);
    expect(isPhotoKey("stories/s1/v1/books/b1/photos/x.png")).toBe(false);
  });
});
