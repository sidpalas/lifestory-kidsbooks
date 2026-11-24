import { describe, expect, it } from "vitest";

import { expiredKeys } from "../src/tasks/sweep-storage.ts";

const now = Date.parse("2026-11-19T12:00:00Z");
const at = (ms: number) => new Date(now - ms);

describe("expiredKeys", () => {
  it("deletes leftover samples, files of families and stories that are gone, and proof PDFs without a proof, nothing else", () => {
    const objects = [
      // The worker check that wrote samples is gone; whatever it left goes, however new.
      { key: "samples/new.svg", lastModified: at(0) },
      // fam_1 exists; fam_12 (its ID extends fam_1's) doesn't. A live family's proof stays however old while its row
      // does (an approved proof); one whose row expired goes, even when it's new.
      { key: "families/fam_1/proofs/proof_a.pdf", lastModified: at(365 * 24 * 60 * 60 * 1000) },
      { key: "families/fam_1/proofs/proof_expired.pdf", lastModified: at(0) },
      // Other files of a live family aren't proofs, so the proof rule leaves them alone.
      { key: "families/fam_1/other/proof_expired.png", lastModified: at(0) },
      { key: "families/fam_12/proofs/proof_b.pdf", lastModified: at(0) },
      { key: "families/fam_12/other/c.png", lastModified: at(0) },
      // A live story's assets stay, however old. A story that's gone (D56's removed parts stories) loses its files
      // once they're a day old; newer ones may belong to an import that hasn't written its row yet.
      { key: "stories/s1/v1/pages/p01/background.png", lastModified: at(365 * 24 * 60 * 60 * 1000) },
      { key: "stories/s12/v1/pages/p01/background.png", lastModified: at(25 * 60 * 60 * 1000) },
      { key: "stories/s12/v2/manifest-new.png", lastModified: at(23 * 60 * 60 * 1000) },
    ];

    const live = {
      families: new Set(["fam_1"]),
      proofs: new Set(["proof_a", "proof_b"]),
      stories: new Set(["s1"]),
      books: new Map(),
    };
    expect(expiredKeys(objects, live, now)).toEqual([
      "samples/new.svg",
      "families/fam_1/proofs/proof_expired.pdf",
      "families/fam_12/proofs/proof_b.pdf",
      "families/fam_12/other/c.png",
      "stories/s12/v1/pages/p01/background.png",
    ]);
  });

  it("deletes a book's photos once nothing may read them, and a missing book's files", () => {
    const day = 24 * 60 * 60 * 1000;
    const book = (status: string, photoReview: boolean, orderedDaysAgo: number | null) => ({
      status,
      photoReview,
      orderedAt: orderedDaysAgo === null ? null : at(orderedDaysAgo * day),
    });
    const live = {
      families: new Set(["fam_1"]),
      proofs: new Set<string>(),
      stories: new Set<string>(),
      books: new Map([
        ["draft", book("draft", false, null)],
        ["ordered", book("making", false, 0)],
        ["review", book("in_review", true, 29)],
        ["review-old", book("in_review", true, 31)],
        ["approved", book("approved", true, 1)],
        ["refused", book("refused", true, 1)],
      ]),
    };
    const keys = [...live.books.keys(), "gone"].flatMap((id) => [
      `families/fam_1/books/${id}/photos/hero/u1`,
      `families/fam_1/books/${id}/likeness/hero/sheet-u1.png`,
    ]);
    expect(
      expiredKeys(
        keys.map((key) => ({ key, lastModified: at(0) })),
        live,
        now,
      ),
    ).toEqual([
      // Ordered without the opt-in: the photo goes, the sheet stays.
      "families/fam_1/books/ordered/photos/hero/u1",
      // Opted in: kept through review, but never past 30 days after the order, and not after the decision.
      "families/fam_1/books/review-old/photos/hero/u1",
      "families/fam_1/books/approved/photos/hero/u1",
      "families/fam_1/books/refused/photos/hero/u1",
      // A deleted book (a swept draft) loses everything.
      "families/fam_1/books/gone/photos/hero/u1",
      "families/fam_1/books/gone/likeness/hero/sheet-u1.png",
    ]);
  });
});
