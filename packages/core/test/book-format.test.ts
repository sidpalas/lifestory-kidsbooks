import { existsSync, readFileSync } from "node:fs";

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  composePage,
  exampleCast,
  isVariableFont,
  manifestAssets,
  resolvePageText,
  resolveText,
  safeArea,
  StoryDraft,
  StoryManifest,
  staticFontIssues,
} from "../src/book-format/index.ts";

const fixture = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
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

describe("StoryManifest (format 4, D56)", () => {
  it("accepts the sample story, and every asset it references is in the fixture", () => {
    const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);
    const assets = manifestAssets(manifest);
    // 4 fonts, the style reference, 2 stock sheets, 3 plates, and 5 figures x (reference, stock).
    expect(assets).toHaveLength(4 + 1 + 2 + 3 + 10);
    expect(assets.filter((asset) => !existsSync(new URL(asset, fixture)))).toEqual([]);
  });

  it("rejects the parts formats it no longer reads", () => {
    expect(errorOf(variant((m) => (m.formatVersion = 3)))).toContain("formatVersion");
  });

  it.each([
    [
      "a figure for an undeclared slot",
      (m: any) => (m.pages[0].illustration.layers[1].slotId = "dog"),
      'unknown slot "dog"',
    ],
    [
      "a window that doesn't contain the figure",
      (m: any) => (m.pages[0].illustration.layers[1].window = [530, 430, 690, 870]),
      "the window must contain the figure's box",
    ],
    [
      "a head outside the window",
      (m: any) => (m.pages[0].illustration.layers[1].head = [0, 0, 10, 10]),
      "the head must be inside the window",
    ],
    ["a figure without its stock drawing", (m: any) => delete m.pages[0].illustration.layers[1].stock, "stock drawing"],
    ["a role without a stock sheet", (m: any) => delete m.characterSlots[0].stockSheet, "needs a sheet"],
    ["a story without a style reference", (m: any) => delete m.photo, "style reference"],
    [
      "a page that doesn't start with its plate",
      (m: any) => (m.pages[1].illustration.layers = m.pages[1].illustration.layers.toReversed()),
      "starts with its plate",
    ],
    [
      "a token naming no role",
      (m: any) => (m.pages[0].frames[0].paragraphs[1].content = "{{friend.name}}"),
      'unknown slot "friend"',
    ],
  ])("rejects %s", (_, edit, message) => {
    expect(errorOf(variant(edit))).toContain(message);
  });
});

describe("composePage", () => {
  const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);
  const page = manifest.pages[0]!;
  const story = { storyId: "story_kite_day", version: 1 };

  it("draws the plate whole, and each figure as its stock drawing in its window", () => {
    expect(composePage(story, page)).toEqual([
      { key: "stories/story_kite_day/v1/pages/p01/plate.svg", rect: [0, 0, 1000, 1000] },
      {
        key: "stories/story_kite_day/v1/pages/p01/hero/stock.svg",
        rect: page.illustration.layers[1]!.kind === "photoFigure" ? page.illustration.layers[1]!.window : [],
      },
      {
        key: "stories/story_kite_day/v1/pages/p01/grownup/stock.svg",
        rect: page.illustration.layers[2]!.kind === "photoFigure" ? page.illustration.layers[2]!.window : [],
      },
    ]);
  });

  it("draws a family's figure where there is one, by its place on the page, and the bald reference in a draft without a stock", () => {
    const draft = {
      ...page,
      illustration: {
        layers: page.illustration.layers.map((l) =>
          l.kind === "photoFigure" && l.slotId === "grownup" ? { ...l, stock: undefined } : l,
        ),
      },
    } as typeof page;
    const keys = composePage(story, draft, (_, index) =>
      index === 0 ? "families/f/books/b/pages/p01-0.png" : undefined,
    ).map((l) => l.key);
    expect(keys).toEqual([
      "stories/story_kite_day/v1/pages/p01/plate.svg",
      "families/f/books/b/pages/p01-0.png",
      "stories/story_kite_day/v1/pages/p01/grownup/reference.svg",
    ]);
  });
});

describe("text frames", () => {
  it("places a frame anywhere inside the safe area, flush with its edges, next to other frames", () => {
    const manifest = Schema.decodeUnknownSync(StoryManifest)(
      variant((m) => {
        m.pages[0].frames.push({
          frameId: "t2",
          box: { xIn: 0.5, yIn: 0.5, widthIn: 7.5, heightIn: 7.5 },
          valign: "middle",
          panel: false,
          paragraphs: [{ style: "body", content: "{{hero.name}} again.\nAnd again." }],
        });
      }),
    );
    expect(manifest.pages[0]!.frames.map((frame) => frame.frameId)).toEqual(["t1", "t2"]);
    expect(safeArea(manifest.trim)).toEqual({ xIn: 0.5, yIn: 0.5, widthIn: 7.5, heightIn: 7.5 });
    // A family's edits address paragraphs across frames in reading order.
    expect(resolvePageText(manifest.pages[0]!, exampleCast(manifest)).map((block) => block.text)).toEqual([
      "The Kite Day",
      expect.any(String),
      "Mia again.\nAnd again.",
    ]);
  });
});

describe("StoryDraft", () => {
  // An author's draft (D37) is the format's shape only, so work in progress saves; publishing decodes it as a StoryManifest.
  it("accepts what publishing rejects: an empty page, a figure with no stock drawing, a token naming no role", () => {
    const draft = variant((m) => {
      delete m.pages[0].illustration.layers[1].stock;
      m.pages[1].illustration.layers = [];
      m.pages[2].frames[0].paragraphs[0].content = "{{friend.name}}";
    });
    expect(Result.isSuccess(Schema.decodeUnknownResult(StoryDraft)(draft))).toBe(true);
    expect(errorOf(draft)).toContain('unknown slot "friend"');
  });

  it("still rejects what isn't the format's shape", () => {
    expect(
      Result.isFailure(Schema.decodeUnknownResult(StoryDraft)(variant((m) => (m.pages[0].art = "two-column")))),
    ).toBe(true);
  });
});

describe("resolveText", () => {
  const content =
    "{{hero.They}} gave {{grownup.name}} {{hero.their}} hat, and {{grownup.they}} thanked {{hero.them}}. It was {{hero.theirs}}; {{hero.they}} made it {{hero.themself}}.";

  it.each([
    ["she/her", "She gave Sam her hat, and he thanked her. It was hers; she made it herself."],
    ["he/him", "He gave Sam his hat, and he thanked him. It was his; he made it himself."],
    ["they/them", "They gave Sam their hat, and he thanked them. It was theirs; they made it themself."],
  ] as const)("resolves %s pronouns, capitalized where the token is", (pronouns, expected) => {
    expect(
      resolveText(content, { hero: { name: "Ada", pronouns }, grownup: { name: "Sam", pronouns: "he/him" } }),
    ).toBe(expected);
  });

  it("previews the sample story with each slot's example character", () => {
    const manifest = Schema.decodeUnknownSync(StoryManifest)(sample);
    const page = manifest.pages.find((p) => p.pageId === "p02")!;
    expect(resolvePageText(page, exampleCast(manifest))[0]).toEqual({
      style: "body",
      text: "The wind tugged. She held on tight, and up it went!",
    });
  });

  it("calls a member by their title where the story asks for it, and by name when they have none", () => {
    const titled = "{{grownup.Title}} hugged {{grownup.name}}'s {{hero.title}}, {{hero.name}}.";
    const cast = {
      hero: { name: "Ada", pronouns: "she/her" as const },
      grownup: { name: "Sam", title: "nana", pronouns: "she/her" as const },
    };
    // A capitalized field capitalizes the title as it does a pronoun; a title is otherwise printed as typed.
    expect(resolveText(titled, cast)).toBe("Nana hugged Sam's Ada, Ada.");
    expect(resolveText("{{grownup.title}}", cast)).toBe("nana");
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
