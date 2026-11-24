import { readFileSync } from "node:fs";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { exampleCast, StoryManifest } from "../src/book-format/index.ts";
import { countPdfPages } from "../src/print.ts";
import { proofPageText } from "../src/proofs.ts";

const manifest = Schema.decodeUnknownSync(StoryManifest)(
  JSON.parse(readFileSync(new URL("../../../fixtures/stories/kite-day/manifest.json", import.meta.url), "utf8")),
);

describe("proofPageText", () => {
  it("prints a family's edit in place of that block only, with its tokens resolved for the proof's cast", () => {
    const [p01, p02] = manifest.pages;
    const cast = {
      ...exampleCast(manifest),
      hero: { ...exampleCast(manifest).hero!, name: "Łucja", pronouns: "she/her" as const },
    };
    const content = {
      cast,
      textEdits: [{ pageId: "p01", blockIndex: 1, content: "{{hero.They}} carried {{hero.their}} kite." }],
    };

    expect(proofPageText(p01!, content)).toEqual([
      { style: "title", text: "The Kite Day" },
      { style: "body", text: "She carried her kite." },
    ]);
    // Page 2 has no edit: the story's own text, with the cast's name.
    expect(
      proofPageText(p02!, content)
        .map((block) => block.text)
        .join(" "),
    ).toContain("The wind tugged. She held on tight");
  });
});

describe("countPdfPages", () => {
  it("counts page objects, not the page tree", () => {
    const pdf = new TextEncoder().encode(
      "<</Type /Pages /Kids [3 0 R 4 0 R]>> <</Type /Page /MediaBox [0 0 630 630]>> <</Type/Page>>",
    );
    expect(countPdfPages(pdf)).toBe(2);
  });
});
