import { existsSync, readFileSync } from "node:fs";
import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  castLook,
  composeIllustration,
  exampleCast,
  isVariableFont,
  manifestAssets,
  resolvePageText,
  resolveText,
  StoryManifest,
  staticFontIssues,
  unapprovedParts,
  unsupportedOptions,
  vocabularyGaps,
  type Look,
} from "../src/book-format/index.ts";

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
    // 4 fonts (2 weights x 2 subsets), 10 art layers, and per page the figures' bases, masks, parts and occluders (counted by hand):
    // a figure with a head has 2 bases x (base, skin, brows) + 2 faces x (3 hairstyles + glasses) = 14 files.
    // p01: 14 + a hand (2 x base, skin) = 18; p05: 28 + a cheese occluder per adult base (asset, skin) = 32.
    expect(assets).toHaveLength(4 + 10 + 18 + 28 + 28 + 28 + 32 + 28);
    expect(unapprovedParts(manifest)).toEqual([]);
    expect(vocabularyGaps(manifest)).toEqual([]);
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
    ["an upside-down box", (m: any) => (m.pages[0].illustration.layers[1].box = [760, 250, 430, 690]), "x0 < x1"],
    ["a box off the illustration", (m: any) => (m.pages[0].illustration.layers[1].box = [0, 0, 1001, 500]), "1000"],
    ["an asset path that climbs out of the story", (m: any) => (m.pages[0].illustration.layers[0].asset = "../other/art.png"), "relative path"],
    ["an absolute asset path", (m: any) => (m.pages[0].illustration.layers[0].asset = "/etc/art.png"), "relative path"],
    ["a font that isn't woff2", (m: any) => (m.fonts[0].asset = "fonts/literata.ttf"), ".woff2"],
    ["a base face of another age", (m: any) => (m.pages[0].illustration.layers[1].bases[0].face = "face:adult-1"), `"face:adult-1" is not a child's face`],
    ["a part for an option outside the vocabulary", (m: any) => (m.pages[0].illustration.layers[1].parts[0].option = "hair:mohawk"), `"hair:mohawk" is not a hair option`],
    ["a part for an option with nothing to draw", (m: any) => (m.pages[0].illustration.layers[1].parts[3].option = "glasses:none"), `"glasses:none" is not a glasses option with a drawing`],
    ["parts on a figure without a head", (m: any) => m.pages[0].illustration.layers[3].parts.push(m.pages[0].illustration.layers[1].parts[0]), "a figure without a head has no parts"],
    ["an example look of another age", (m: any) => (m.characterSlots[0].example.look.face = "face:adult-1"), "the example's face is not a child's"],
    ["a palette for an unknown option", (m: any) => (m.palettes.skin["skin:s9"] = m.palettes.skin["skin:s1"]), `"skin:s9" is not a skin option`],
    ["a part order missing an axis", (m: any) => (m.partOrder = ["hair"]), "must list each of hair, glasses once"],
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

const decoded = (m: unknown) => Schema.decodeUnknownSync(StoryManifest)(m);
const childLook = (face: Look["face"], hair: Look["hair"]): Look => ({ face, skin: "skin:s3", hair, hairColour: "hair-colour:brown", glasses: "glasses:round" });

describe("looks against a story (D26)", () => {
  it("reports exactly the axis a story can't draw, and only for the face missing its part", () => {
    // p04's child figure loses the long hairstyle on the oval face only.
    const manifest = decoded(
      variant((m) => {
        const hero = m.pages[3].illustration.layers.find((layer: any) => layer.slotId === "hero");
        hero.parts = hero.parts.filter((part: any) => !(part.face === "face:child-2" && part.option === "hair:long"));
      }),
    );
    expect(vocabularyGaps(manifest)).toEqual(['p04/hero: no part for "hair:long" on "face:child-2"']);
    expect(unsupportedOptions(manifest, "hero", childLook("face:child-2", "hair:long"))).toEqual(["hair"]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:child-1", "hair:long"))).toEqual([]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:child-2", "hair:curly"))).toEqual([]);
  });

  it("rejects a face of another age and a colour the story has no palette for", () => {
    const manifest = decoded(variant((m) => delete m.palettes.skin["skin:s5"]));
    expect(vocabularyGaps(manifest)).toEqual(['no palette for "skin:s5"']);
    expect(unsupportedOptions(manifest, "hero", { ...childLook("face:adult-1", "hair:short"), skin: "skin:s5" }).toSorted()).toEqual(["face", "skin"]);
  });

  it("a book's override stands in only for options the story can't draw, and never for another age", () => {
    const manifest = decoded(
      variant((m) => {
        const hero = m.pages[3].illustration.layers.find((layer: any) => layer.slotId === "hero");
        hero.parts = hero.parts.filter((part: any) => !(part.face === "face:child-2" && part.option === "hair:long"));
      }),
    );
    const longOval = childLook("face:child-2", "hair:long");
    expect(castLook(manifest, "hero", longOval)).toEqual({ look: longOval, wrongAge: false, unsupported: ["hair"] });
    // The parent picks a stand-in hairstyle for this book; the other axes stay the character's own.
    expect(castLook(manifest, "hero", longOval, { hair: "hair:curly", glasses: "glasses:round" })).toEqual({
      look: { ...longOval, hair: "hair:curly" },
      wrongAge: false,
      unsupported: [],
    });
    // Once the character's own option is drawable (another face here), the override no longer applies.
    const longRound = childLook("face:child-1", "hair:long");
    expect(castLook(manifest, "hero", longRound, { hair: "hair:curly" }).look).toEqual(longRound);
    // A stand-in the story can't draw either leaves the axis unsupported.
    expect(castLook(manifest, "hero", longOval, { hair: "hair:long" }).unsupported).toEqual(["hair"]);
    // A grown-up's face can't fill a child's role, whatever the override says.
    expect(castLook(manifest, "hero", childLook("face:adult-1", "hair:short"), { face: "face:child-1" })).toMatchObject({ wrongAge: true, unsupported: ["face"] });
  });
});

describe("composeIllustration", () => {
  const manifest = decoded(sample);
  const cast = exampleCast(manifest);

  it("stacks base, parts in order, then the occluder, each figure between the page's art layers", () => {
    // p05: background, Mia (curly hair, no glasses), Grandpa Joe (short hair, round glasses, cheese in front).
    const layers = composeIllustration(manifest, manifest.pages[4]!, cast).map((layer) => layer.asset);
    expect(layers).toEqual([
      "pages/p05/background.svg",
      "pages/p05/hero/base-child-1.svg",
      "pages/p05/hero/child-1-curly.svg",
      "pages/p05/grownup/base-adult-2.svg",
      "pages/p05/grownup/adult-2-short.svg",
      "pages/p05/grownup/adult-2-glasses-round.svg",
      "pages/p05/grownup/occluder-adult-2.svg",
    ]);
  });

  it("recolours the occluder's skin, so a hand in front of the face matches the face", () => {
    const layers = composeIllustration(manifest, manifest.pages[4]!, cast);
    const skin = manifest.palettes.skin["skin:s2"];
    expect(layers.at(-1)!.recolour).toEqual([{ mask: "pages/p05/grownup/occluder-adult-2-skin.svg", palette: skin }]);
    expect(layers[3]!.recolour.map((region) => region.mask)).toEqual([
      "pages/p05/grownup/base-adult-2-skin.svg",
      "pages/p05/grownup/base-adult-2-brows.svg",
    ]);
  });

  it("draws only the recoloured hand when a figure has no head in frame", () => {
    const layers = composeIllustration(manifest, manifest.pages[0]!, cast);
    expect(layers.at(-1)).toEqual({
      asset: "pages/p01/grownup/base-adult-2.svg",
      rect: [0, 440, 260, 540],
      recolour: [{ mask: "pages/p01/grownup/base-adult-2-skin.svg", palette: manifest.palettes.skin["skin:s2"] }],
    });
  });

  it("places a part inside its figure's box and honours a page's own part order", () => {
    const edited = decoded(variant((m) => (m.pages[0].illustration.layers[1].parts[1].at = [0, 0, 500, 1000])));
    // Box [430, 250, 760, 690]; the left half of it.
    const hair = composeIllustration(edited, edited.pages[0]!, cast).find((layer) => layer.asset.endsWith("child-1-curly.svg"))!;
    expect(hair.rect).toEqual([430, 250, 595, 690]);

    // p06 draws glasses under the hair.
    const withGlasses = { ...cast, hero: { ...cast.hero!, look: { ...cast.hero!.look, glasses: "glasses:round" as const } } };
    const hero = composeIllustration(manifest, manifest.pages[5]!, withGlasses)
      .map((layer) => layer.asset)
      .filter((asset) => asset.includes("/hero/"));
    expect(hero).toEqual(["pages/p06/hero/base-child-1.svg", "pages/p06/hero/child-1-glasses-round.svg", "pages/p06/hero/child-1-curly.svg"]);
  });
});

describe("story fonts for print (D27)", () => {
  const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);

  it("accepts the sample's static fonts, and names a weight range or a text style's undeclared weight", () => {
    expect(staticFontIssues(manifest)).toEqual([]);
    const ranged = Schema.decodeUnknownSync(StoryManifest)(variant((m) => (m.fonts[0].weight = "200 900")));
    expect(staticFontIssues(ranged)).toEqual([
      "fonts/literata-latin-450-normal.woff2: declare the one weight this static file has, not a range (200 900)",
    ]);
    const unmatched = Schema.decodeUnknownSync(StoryManifest)(variant((m) => (m.textStyles.body.weight = 400)));
    expect(staticFontIssues(unmatched)).toEqual(['textStyles.body: no "Literata" file declares weight 400']);
  });

  it("finds an fvar table in a WOFF2 directory, past tables with and without transform lengths", () => {
    for (const font of manifest.fonts) expect(isVariableFont(readFileSync(new URL(font.asset, fixture)))).toBe(false);
    // Header (48 bytes, 3 tables), then: glyf transformed (version 0: origLength 128, transformLength 5),
    // hmtx untransformed (version 0: origLength 16 only), fvar (origLength 16).
    const woff2 = new Uint8Array(48 + 9);
    const view = new DataView(woff2.buffer);
    view.setUint32(0, 0x774f4632);
    view.setUint16(12, 3);
    woff2.set([10, 0x81, 0x00, 0x05, 3, 0x10, 47, 0x10], 48);
    expect(isVariableFont(woff2)).toBe(true);
    woff2[54] = 46; // feat instead of fvar
    expect(isVariableFont(woff2)).toBe(false);
  });
});
