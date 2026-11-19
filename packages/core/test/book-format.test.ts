import { existsSync, readFileSync } from "node:fs";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  castLook,
  composeIllustration,
  decodeStoryManifest,
  exampleCast,
  isVariableFont,
  manifestAssets,
  resolvePageText,
  resolveText,
  StoryDraft,
  StoryManifest,
  staticFontIssues,
  unapprovedParts,
  unsupportedOptions,
  vocabularyGaps,
  type Look,
} from "../src/book-format/index.ts";
import { Look as LookSchema } from "../src/looks/vocabulary.ts";

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

  it("accepts the watercolour sample, whose raster figures cover the vocabulary with approved parts", () => {
    const dir = new URL("../../../fixtures/stories/paper-boat/", import.meta.url);
    const manifest = Schema.decodeUnknownSync(StoryManifest)(JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8")));
    expect(unapprovedParts(manifest)).toEqual([]);
    expect(vocabularyGaps(manifest)).toEqual([]);
    expect(manifest.trim.safeMarginIn).toBeGreaterThanOrEqual(0.5);
    expect(manifestAssets(manifest).filter((asset) => !existsSync(new URL(asset, dir)))).toEqual([]);
  });

  it("rejects a format version it doesn't know", () => {
    expect(errorOf(variant((m) => (m.formatVersion = 3)))).toContain("formatVersion");
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
    ["a base for an age the role doesn't accept", (m: any) => (m.pages[0].illustration.layers[1].bases[0].age = "adult"), `the figure doesn't draw "adult"`],
    ["a base for another age than the figure's pinned one", (m: any) => (m.pages[0].illustration.layers[1].age = "toddler"), `the figure doesn't draw "young-child"`],
    [
      "a hairstyle part at an age that has none",
      (m: any) => {
        m.characterSlots[0].ages.push("baby");
        m.pages[0].illustration.layers[1].parts[0].age = "baby";
      },
      `"baby" has no hair parts`,
    ],
    ["a part for an option outside the vocabulary", (m: any) => (m.pages[0].illustration.layers[1].parts[0].option = "hair:mohawk"), `"hair:mohawk" is not a hair option`],
    ["a part for an option with nothing to draw", (m: any) => (m.pages[0].illustration.layers[1].parts.find((part: any) => part.axis === "glasses").option = "glasses:none"), `"glasses:none" is not a glasses option with a drawing`],
    ["parts on a figure without a head", (m: any) => m.pages[0].illustration.layers[3].parts.push(m.pages[0].illustration.layers[1].parts[0]), "a figure without a head has no parts"],
    ["an example look of another age", (m: any) => (m.characterSlots[0].example.look.age = "adult"), "the example is not one of the slot's ages"],
    ["a role accepting no age", (m: any) => (m.characterSlots[0].ages = []), "ages"],
    ["a palette for an unknown option", (m: any) => (m.palettes.skin["skin:s9"] = m.palettes.skin["skin:s1"]), `"skin:s9" is not a skin option`],
    ["a part order missing an axis", (m: any) => (m.partOrder = ["hair"]), "must list each of hair, glasses once"],
    ["a safe margin wider than the page", (m: any) => (m.trim.safeMarginIn = 4.25), "no room for text"],
    ["a story without pages", (m: any) => (m.pages = []), "a story needs at least one page"],
    ["a page without layers", (m: any) => (m.pages[1].illustration.layers = []), "a page needs at least one layer"],
    ["a figure without bases", (m: any) => (m.pages[0].illustration.layers[1].bases = []), "a figure needs at least one base"],
  ])("rejects %s", (_, edit, message) => {
    expect(errorOf(variant(edit))).toContain(message);
  });
});

describe("StoryDraft", () => {
  // An author's draft (D37) is the format's shape only, so work in progress saves; publishing decodes it as a StoryManifest.
  it("accepts what publishing rejects: an empty page, a figure with no bases, a token naming no role", () => {
    const draft = variant((m) => {
      m.pages[0].illustration.layers[1].bases = [];
      m.pages[1].illustration.layers = [];
      m.pages[2].text[0].content = "{{friend.name}}";
    });
    expect(Result.isSuccess(Schema.decodeUnknownResult(StoryDraft)(draft))).toBe(true);
    expect(errorOf(draft)).toContain('unknown slot "friend"');
  });

  it("still rejects what isn't the format's shape", () => {
    expect(Result.isFailure(Schema.decodeUnknownResult(StoryDraft)(variant((m) => (m.pages[0].layout = "two-column"))))).toBe(true);
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
      text: "Grandpa checked the fuel. Mia checked the cocoa. She buckled herself in tight.",
    });
  });

  it("calls a member by their title where the story asks for it, and by name when they have none", () => {
    const titled = "{{grownup.Title}} hugged {{grownup.name}}'s {{hero.title}}, {{hero.name}}.";
    const cast = { hero: { name: "Ada", pronouns: "she/her" as const }, grownup: { name: "Sam", title: "nana", pronouns: "she/her" as const } };
    // A capitalized field capitalizes the title as it does a pronoun; a title is otherwise printed as typed.
    expect(resolveText(titled, cast)).toBe("Nana hugged Sam's Ada, Ada.");
    expect(resolveText("{{grownup.title}}", cast)).toBe("nana");
  });
});

const decoded = (m: unknown) => Schema.decodeUnknownSync(StoryManifest)(m);
const childLook = (face: Look["face"], hair: Look["hair"], age: Look["age"] = "young-child"): Look => ({
  age,
  face,
  features: "features:defined",
  skin: "skin:s3",
  hair,
  hairColour: "hair-colour:brown",
  glasses: "glasses:round",
});
/** The sample with p04's child figure missing the long hairstyle on the oval face, for young children only. */
const missingLongOval = () =>
  decoded(
    variant((m) => {
      const hero = m.pages[3].illustration.layers.find((layer: any) => layer.slotId === "hero");
      hero.parts = hero.parts.filter((part: any) => !(part.age === "young-child" && part.face === "face:oval" && part.option === "hair:long"));
    }),
  );

/** p02's grown-up with a softer adult round-face base and its parts (D40). */
const withSoft = (dropPart = false) =>
  decoded(
    variant((m) => {
      const grownup = m.pages[1].illustration.layers.find((layer: any) => layer.slotId === "grownup");
      const base = grownup.bases.find((b: any) => b.age === "adult" && b.face === "face:round");
      grownup.bases.push({ ...base, features: "features:soft", asset: "soft/base.svg" });
      const parts = grownup.parts.filter((part: any) => part.age === "adult" && part.face === "face:round");
      grownup.parts.push(
        ...parts
          .filter((part: any) => !(dropPart && part.option === "hair:long"))
          .map((part: any) => ({ ...part, features: "features:soft", asset: `soft/${part.option.replace(":", "-")}.svg` })),
      );
    }),
  );
const soft = (face: Look["face"], age: Look["age"] = "adult"): Look => ({ ...childLook(face, "hair:long", age), features: "features:soft" });
const grownup = (manifest: StoryManifest, look: Look) =>
  composeIllustration(manifest, manifest.pages[1]!, { grownup: { name: "Sam", pronouns: "she/her", look } })
    .map((layer) => layer.asset)
    .filter((asset) => asset.includes("grownup") || asset.startsWith("soft/"));

describe("looks against a story (D26, D29)", () => {
  it("reports exactly the axis a story can't draw, and only for the age and face missing its part", () => {
    const manifest = missingLongOval();
    expect(vocabularyGaps(manifest)).toEqual(['p04/hero: no part for "hair:long" on "young-child/face:oval"']);
    expect(unsupportedOptions(manifest, "hero", childLook("face:oval", "hair:long"))).toEqual(["hair"]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:round", "hair:long"))).toEqual([]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:oval", "hair:curly"))).toEqual([]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:oval", "hair:long", "older-child"))).toEqual([]);
  });

  it("rejects an age the role doesn't accept and a colour the story has no palette for", () => {
    const manifest = decoded(variant((m) => delete m.palettes.skin["skin:s5"]));
    expect(vocabularyGaps(manifest)).toEqual(['no palette for "skin:s5"']);
    expect(unsupportedOptions(manifest, "hero", { ...childLook("face:round", "hair:short"), skin: "skin:s5" })).toEqual(["skin"]);
    // A role accepting young and older children: a teen or a toddler can't play it.
    expect(unsupportedOptions(manifest, "hero", childLook("face:round", "hair:short", "teen"))).toEqual(["age"]);
    expect(unsupportedOptions(manifest, "hero", childLook("face:round", "hair:short", "toddler"))).toEqual(["age"]);
  });

  it("a book's override stands in only for options the story can't draw, and never for another age", () => {
    const manifest = missingLongOval();
    const longOval = childLook("face:oval", "hair:long");
    expect(castLook(manifest, "hero", longOval)).toEqual({ look: longOval, wrongAge: false, unsupported: ["hair"] });
    // The parent picks a stand-in hairstyle for this book; the other axes stay the character's own.
    expect(castLook(manifest, "hero", longOval, { hair: "hair:curly", glasses: "glasses:none" })).toEqual({
      look: { ...longOval, hair: "hair:curly" },
      wrongAge: false,
      unsupported: [],
    });
    // Once the character's own option is drawable (another face here), the override no longer applies.
    const longRound = childLook("face:round", "hair:long");
    expect(castLook(manifest, "hero", longRound, { hair: "hair:curly" }).look).toEqual(longRound);
    // A stand-in the story can't draw either leaves the axis unsupported.
    expect(castLook(manifest, "hero", longOval, { hair: "hair:long" }).unsupported).toEqual(["hair"]);
    // A grown-up can't fill a child's role, whatever the override says.
    expect(castLook(manifest, "hero", childLook("face:round", "hair:short", "adult"), { face: "face:round" })).toEqual({
      look: childLook("face:round", "hair:short", "adult"),
      wrongAge: true,
      unsupported: ["age"],
    });
  });

  it("draws softer features where a story has them, and the defined base where it doesn't (D40)", () => {
    // Only the adult round face has a softer base; the oval and older adults stay defined only.
    const manifest = withSoft();
    expect(vocabularyGaps(manifest)).toEqual([]);
    expect(grownup(manifest, soft("face:round"))).toEqual(["soft/base.svg", "soft/hair-long.svg", "soft/glasses-round.svg"]);
    // No softer oval base, so the defined one draws, with nothing reported unsupported.
    const definedOval = grownup(manifest, { ...soft("face:oval"), features: "features:defined" });
    expect(grownup(manifest, soft("face:oval"))).toEqual(definedOval);
    expect(unsupportedOptions(manifest, "grownup", soft("face:oval"))).toEqual([]);
    // A softer base must have its parts.
    expect(vocabularyGaps(withSoft(true))).toEqual(['p02/grownup: no part for "hair:long" on "adult/face:round/features:soft"']);
    // Looks saved before the axis existed are the defined ones.
    const { features: _, ...stored } = soft("face:round");
    expect(Schema.decodeUnknownSync(LookSchema)(stored).features).toBe("features:defined");
  });

  it("draws a figure pinned to an age at that age, whatever age the character is", () => {
    // p02 draws the hero as a toddler (D29: a character who grows up during the story), with toddler bases and hair
    // parts that reuse p01's drawings so they can be told apart. Toddlers have no glasses parts.
    const manifest = decoded(
      variant((m) => {
        const p01 = m.pages[0].illustration.layers.find((layer: any) => layer.slotId === "hero");
        const hero = m.pages[1].illustration.layers.find((layer: any) => layer.slotId === "hero");
        hero.age = "toddler";
        hero.bases = p01.bases.filter((base: any) => base.age === "young-child").map((base: any) => ({ ...base, age: "toddler" }));
        hero.parts = p01.parts
          .filter((part: any) => part.age === "young-child" && part.axis === "hair")
          .map((part: any) => ({ ...part, age: "toddler" }));
      }),
    );
    expect(vocabularyGaps(manifest)).toEqual([]);
    for (const age of ["young-child", "older-child"] as const) {
      const look = childLook("face:oval", "hair:long", age);
      expect(unsupportedOptions(manifest, "hero", look)).toEqual([]);
      const hero = composeIllustration(manifest, manifest.pages[1]!, { hero: { name: "Ada", pronouns: "she/her", look } })
        .map((layer) => layer.asset)
        .filter((asset) => asset.includes("/hero/"));
      // The toddler base and hairstyle, and no glasses although the look has them.
      expect(hero).toEqual(["pages/p01/hero/base-child-2.svg", "pages/p01/hero/child-2-long.svg"]);
    }
  });

  it("reads a stored format 1 manifest as the format 2 version that draws the same", () => {
    // Format 1 as stored before D29: one age per role, faces bound to an age.
    const format1 = variant((m) => {
      const faces: Record<string, string> = { "young-child/face:round": "face:child-1", "young-child/face:oval": "face:child-2", "adult/face:oval": "face:adult-1", "adult/face:round": "face:adult-2" };
      const old = (item: any) => {
        const { age, face, ...rest } = item;
        return { ...rest, face: faces[`${age}/${face}`] };
      };
      m.formatVersion = 1;
      for (const slot of m.characterSlots) {
        slot.age = slot.ages[0] === "adult" ? "adult" : "child";
        delete slot.ages;
        slot.example.look = old(slot.example.look);
      }
      for (const page of m.pages) {
        for (const layer of page.illustration.layers) {
          if (layer.kind !== "figure") continue;
          layer.bases = layer.bases.filter((base: any) => faces[`${base.age}/${base.face}`]).map(old);
          layer.parts = layer.parts.filter((part: any) => faces[`${part.age}/${part.face}`]).map(old);
        }
      }
    });
    const upgraded = Effect.runSync(decodeStoryManifest(format1));
    expect(upgraded.characterSlots.map((slot) => slot.ages)).toEqual([["young-child"], ["adult"]]);
    const current = decoded(sample);
    for (const page of current.pages) {
      expect(composeIllustration(upgraded, upgraded.pages.find((p) => p.pageId === page.pageId)!, exampleCast(upgraded))).toEqual(
        composeIllustration(current, page, exampleCast(current)),
      );
    }
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

  it("draws a base's overlay as it is, above the recoloured base and below the parts", () => {
    const withOverlay = decoded(
      variant((m) => {
        for (const base of m.pages[4].illustration.layers[2].bases) base.overlay = base.asset.replace(".svg", "-overlay.svg");
      }),
    );
    const layers = composeIllustration(withOverlay, withOverlay.pages[4]!, cast);
    expect(layers.slice(3, 6).map((layer) => layer.asset)).toEqual([
      "pages/p05/grownup/base-adult-2.svg",
      "pages/p05/grownup/base-adult-2-overlay.svg",
      "pages/p05/grownup/adult-2-short.svg",
    ]);
    expect(layers[4]!.recolour).toEqual([]);
    expect(manifestAssets(withOverlay)).toContain("pages/p05/grownup/base-adult-2-overlay.svg");
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
    const edited = decoded(
      variant((m) => {
        const curly = m.pages[0].illustration.layers[1].parts.find((part: any) => part.age === "young-child" && part.asset.endsWith("child-1-curly.svg"));
        curly.at = [0, 0, 500, 1000];
      }),
    );
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
