import { describe, expect, it } from "vitest";
import { expiredKeys, SAMPLE_TTL_MS } from "../src/tasks/sweep-storage.ts";

const now = Date.parse("2026-11-19T12:00:00Z");
const at = (ms: number) => new Date(now - ms);

describe("expiredKeys", () => {
  it("deletes old samples, the files of families that are gone, and proof PDFs without a proof, nothing else", () => {
    const objects = [
      { key: "samples/old.svg", lastModified: at(SAMPLE_TTL_MS + 1000) },
      { key: "samples/young.svg", lastModified: at(SAMPLE_TTL_MS - 1000) },
      // fam_1 exists; fam_12 (its ID extends fam_1's) doesn't. A live family's proof stays however old while its row
      // does (an approved proof); one whose row expired goes, even when it's new.
      { key: "families/fam_1/proofs/proof_a.pdf", lastModified: at(365 * 24 * 60 * 60 * 1000) },
      { key: "families/fam_1/proofs/proof_expired.pdf", lastModified: at(0) },
      // Other files of a live family aren't proofs, so the proof rule leaves them alone.
      { key: "families/fam_1/other/proof_expired.png", lastModified: at(0) },
      { key: "families/fam_12/proofs/proof_b.pdf", lastModified: at(0) },
      { key: "families/fam_12/other/c.png", lastModified: at(0) },
      // Story assets are never swept, however old.
      { key: "stories/s1/v1/pages/p01/background.png", lastModified: at(SAMPLE_TTL_MS * 10) },
    ];

    expect(expiredKeys(objects, { families: new Set(["fam_1"]), proofs: new Set(["proof_a", "proof_b"]) }, now)).toEqual([
      "samples/old.svg",
      "families/fam_1/proofs/proof_expired.pdf",
      "families/fam_12/proofs/proof_b.pdf",
      "families/fam_12/other/c.png",
    ]);
  });
});
