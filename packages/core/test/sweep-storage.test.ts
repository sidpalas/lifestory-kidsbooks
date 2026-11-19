import { describe, expect, it } from "vitest";
import { expiredKeys, SAMPLE_TTL_MS } from "../src/tasks/sweep-storage.ts";

const now = Date.parse("2026-11-19T12:00:00Z");
const at = (ms: number) => new Date(now - ms);

describe("expiredKeys", () => {
  it("deletes old samples and the files of families that are gone, nothing else", () => {
    const objects = [
      { key: "samples/old.svg", lastModified: at(SAMPLE_TTL_MS + 1000) },
      { key: "samples/young.svg", lastModified: at(SAMPLE_TTL_MS - 1000) },
      // fam_1 exists; fam_12 (its ID extends fam_1's) doesn't, and old files of a live family stay.
      { key: "families/fam_1/proofs/a.pdf", lastModified: at(365 * 24 * 60 * 60 * 1000) },
      { key: "families/fam_12/proofs/b.pdf", lastModified: at(0) },
      { key: "families/fam_12/other/c.png", lastModified: at(0) },
      // Story assets are never swept, however old.
      { key: "stories/s1/v1/pages/p01/background.png", lastModified: at(SAMPLE_TTL_MS * 10) },
    ];

    expect(expiredKeys(objects, new Set(["fam_1"]), now)).toEqual([
      "samples/old.svg",
      "families/fam_12/proofs/b.pdf",
      "families/fam_12/other/c.png",
    ]);
  });
});
