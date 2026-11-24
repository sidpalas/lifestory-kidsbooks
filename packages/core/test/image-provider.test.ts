import { describe, expect, it } from "vitest";

import { renderPlaceholder } from "../src/image-provider.ts";

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
