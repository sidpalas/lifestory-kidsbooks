import { existsSync, readFileSync } from "node:fs";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { exampleCast, manifestAssets, resolvePageText, resolveText, StoryManifest } from "../src/book-format/index.ts";

const fixture = new URL("../../../fixtures/stories/moon-picnic/", import.meta.url);
const sample = JSON.parse(readFileSync(new URL("manifest.json", fixture), "utf8"));

const decode = (input: unknown) => Schema.decodeUnknownResult(StoryManifest)(input);
const errorOf = (input: unknown) => {
  const result = decode(input);
  return Result.isFailure(result) ? result.failure.message : "decoded without error";
};
/** The sample manifest with `edit` applied to a deep copy. */
const variant = (edit: (m: any) => void) => {
  const copy = structuredClone(sample);
  edit(copy);
  return copy;
};

describe("StoryManifest", () => {
  it("accepts the sample story, and every asset it references is in the fixture", () => {
    const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);
    const assets = manifestAssets(manifest);
    expect(assets).toHaveLength(2 + 10);
    expect(assets.filter((asset) => !existsSync(new URL(asset, fixture)))).toEqual([]);
  });

  it("rejects a format version it doesn't know", () => {
    expect(errorOf(variant((m) => (m.formatVersion = 2)))).toContain("formatVersion");
  });

  it.each([
    ["a character layer for an undeclared slot", (m: any) => (m.pages[0].illustration.layers[1].slotId = "dog"), 'unknown slot "dog"'],
    ["a token for an undeclared slot", (m: any) => (m.pages[0].text[1].content = "{{dog.name}} barked."), 'unknown slot "dog"'],
    ["a token with an unknown field", (m: any) => (m.pages[0].text[1].content = "{{hero.age}} years"), 'unknown field "age"'],
    ["a malformed token", (m: any) => (m.pages[0].text[1].content = "{{hero name}} waved"), "malformed token"],
    ["a duplicate page", (m: any) => (m.pages[1].pageId = "p01"), 'duplicate pageId "p01"'],
    ["a duplicate slot", (m: any) => (m.characterSlots[1].slotId = "hero"), 'duplicate slotId "hero"'],
    ["a text style with an undeclared font", (m: any) => (m.textStyles.body.fontFamily = "Comic Sans"), 'font "Comic Sans" is not in fonts'],
    ["an upside-down box", (m: any) => (m.pages[0].illustration.layers[1].box = [690, 430, 250, 760]), "y0 < y1"],
    ["a box off the illustration", (m: any) => (m.pages[0].illustration.layers[1].box = [0, 0, 1001, 500]), "1000"],
    ["an asset path that climbs out of the story", (m: any) => (m.pages[0].illustration.layers[0].asset = "../other/art.png"), "relative path"],
    ["an absolute asset path", (m: any) => (m.pages[0].illustration.layers[0].asset = "/etc/art.png"), "relative path"],
    ["a font that isn't woff2", (m: any) => (m.fonts[0].asset = "fonts/literata.ttf"), ".woff2"],
    ["a safe margin wider than the page", (m: any) => (m.trim.safeMarginIn = 4.25), "no room for text"],
  ])("rejects %s", (_, edit, message) => {
    expect(errorOf(variant(edit))).toContain(message);
  });
});

describe("resolveText", () => {
  const content = "{{hero.They}} gave {{grownup.name}} {{hero.their}} hat, and {{grownup.they}} thanked {{hero.them}}. It was {{hero.theirs}}; {{hero.they}} made it {{hero.themself}}.";

  it.each([
    ["she/her", "She gave Sam her hat, and he thanked her. It was hers; she made it herself."],
    ["he/him", "He gave Sam his hat, and he thanked him. It was his; he made it himself."],
    ["they/them", "They gave Sam their hat, and he thanked them. It was theirs; they made it themself."],
  ] as const)("resolves %s pronouns, capitalized where the token is", (pronouns, expected) => {
    expect(resolveText(content, { hero: { name: "Ada", pronouns }, grownup: { name: "Sam", pronouns: "he/him" } })).toBe(expected);
  });

  it("previews the sample story with each slot's example character", () => {
    const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);
    const page = manifest.pages.find((p) => p.pageId === "p03")!;
    expect(resolvePageText(page, exampleCast(manifest))[0]).toEqual({
      style: "body",
      text: "Grandpa Joe checked the fuel. Mia checked the cocoa. She buckled herself in tight.",
    });
  });
});
