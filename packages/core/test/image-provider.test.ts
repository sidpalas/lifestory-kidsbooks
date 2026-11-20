import { describe, expect, it } from "vitest";

import { renderPlaceholder } from "../src/image-provider.ts";
import { signBody, verifySignature } from "../src/providers/modal.ts";

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

describe("Modal request signatures", () => {
  const body = '{"generationId":"gen_1","status":"succeeded","contentType":"image/png"}';
  // From `openssl dgst -sha256 -hmac test-secret`, the same HMAC modal/flux_klein.py computes.
  const signature = "sha256=d0dc8cd2c48a1a7a4e02158be673731837e917fae712854398b61134d8255ac1";

  it("matches the HMAC the Modal function computes", () => {
    expect(signBody("test-secret", body)).toBe(signature);
    expect(verifySignature("test-secret", body, signature)).toBe(true);
  });

  it("rejects a changed body, another secret, or a missing header", () => {
    expect(verifySignature("test-secret", body.replace("succeeded", "failed"), signature)).toBe(false);
    expect(verifySignature("other-secret", body, signature)).toBe(false);
    expect(verifySignature("test-secret", body, null)).toBe(false);
  });
});
