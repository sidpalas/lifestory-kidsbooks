import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { checkPrintReady, printTrimIssues, setPrintBoxes } from "../src/print-ready.ts";

// A small book keeps the fixtures fast: a 2 × 3 in trim, so a page with Lulu's 0.125 in bleed is 2.25 × 3.25 in
// (162 × 234 pt), and art filling it at 300 ppi is 675 × 975 pixels.
const trim = { widthIn: 2, heightIn: 3 };
const page = { width: 162, height: 234 };
const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c84" } })
    .jpeg()
    .toBuffer();
const pngWithAlpha = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 200, g: 120, b: 60, alpha: 0.5 } } })
    .png()
    .toBuffer();

/** A PDF of `pages` pages, each drawn by `draw`, with print boxes set unless `boxes` is false. */
const book = async (
  draw: (
    doc: PDFDocument,
    pdfPage: ReturnType<PDFDocument["addPage"]>,
    index: number,
  ) => Promise<void> = async () => {},
  {
    pages = 2,
    size = page,
    boxes = true,
  }: { pages?: number; size?: { width: number; height: number }; boxes?: boolean } = {},
) => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) await draw(doc, doc.addPage([size.width, size.height]), i);
  const bytes = await doc.save();
  return boxes ? setPrintBoxes(bytes, trim) : bytes;
};
const fullBleedArt =
  (pixels = { width: 675, height: 975 }) =>
  async (doc: PDFDocument, pdfPage: ReturnType<PDFDocument["addPage"]>) => {
    const image = await doc.embedJpg(await jpeg(pixels.width, pixels.height));
    pdfPage.drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
  };

describe("checkPrintReady", () => {
  it("passes opaque full-bleed art at 300 ppi on pages of trim + bleed with their boxes", async () => {
    const report = await checkPrintReady(await book(fullBleedArt()), trim);
    expect(report.issues).toEqual([]);
    expect(report.images).toEqual([
      { page: 1, pixels: "675×975", ppi: 300, colourSpace: "DeviceRGB", filter: "DCTDecode" },
      { page: 2, pixels: "675×975", ppi: 300, colourSpace: "DeviceRGB", filter: "DCTDecode" },
    ]);
  });

  it("sets the TrimBox to the trim inset by the bleed, and the BleedBox to the page", async () => {
    const doc = await PDFDocument.load(await book());
    const first = doc.getPage(0);
    expect(first.getTrimBox()).toEqual({ x: 9, y: 9, width: 144, height: 216 });
    expect(first.getBleedBox()).toEqual({ x: 0, y: 0, width: 162, height: 234 });
  });

  it("needs TrimBox and BleedBox", async () => {
    const report = await checkPrintReady(await book(fullBleedArt(), { boxes: false }), trim);
    expect(report.issues).toEqual([
      "page 1: no TrimBox",
      "page 1: no BleedBox",
      "page 2: no TrimBox",
      "page 2: no BleedBox",
    ]);
  });

  it("needs pages of trim + 0.125 in bleed, not the trim alone, and one size throughout", async () => {
    const trimOnly = await checkPrintReady(await book(undefined, { size: { width: 144, height: 216 } }), trim);
    expect(trimOnly.issues).toContain(
      "page 1: page is 2 × 3 in; a 2 × 3 in book with Lulu's 0.125 in bleed needs 2.25 × 3.25 in",
    );

    const mixed = await book(async (_doc, pdfPage, i) => {
      if (i === 1) pdfPage.setSize(page.width + 36, page.height);
    });
    expect((await checkPrintReady(mixed, trim)).issues).toContain(
      "pages differ in size (2.25 × 3.25 in, 2.75 × 3.25 in); Lulu needs one size",
    );
  });

  it("needs at least two pages", async () => {
    expect((await checkPrintReady(await book(fullBleedArt(), { pages: 1 }), trim)).issues).toEqual([
      "1 pages; Lulu needs at least 2",
    ]);
  });

  it("measures each image where it's drawn, through rotation and nested forms", async () => {
    // 450 pixels across 2.25 in is 200 ppi.
    const low = await checkPrintReady(await book(fullBleedArt({ width: 450, height: 650 })), trim);
    expect(low.issues).toContain("page 1: an image (450×650) prints at 200 ppi; Lulu needs 300");

    // 300 × 150 pixels drawn 1 × 0.5 in and turned 30°: still 300 ppi, since rotation doesn't change resolution.
    const rotated = await book(async (doc, pdfPage) => {
      const image = await doc.embedJpg(await jpeg(300, 150));
      pdfPage.drawImage(image, { x: 40, y: 40, width: 72, height: 36, rotate: degrees(30) });
    });
    expect((await checkPrintReady(rotated, trim)).images.map((image) => image.ppi)).toEqual([300, 300]);

    // A page of 300 ppi art placed as a form at 40% of its size: 675 pixels across 0.9 in is 750 ppi, over Lulu's 600.
    const art = await PDFDocument.create();
    await fullBleedArt()(art, art.addPage([page.width, page.height]));
    const shrunk = await book(async (doc, pdfPage) => {
      const [embedded] = await doc.embedPdf(await art.save());
      pdfPage.drawPage(embedded!, { x: 10, y: 10, xScale: 0.4, yScale: 0.4 });
    });
    const report = await checkPrintReady(shrunk, trim);
    expect(report.images.map((image) => image.ppi)).toEqual([750, 750]);
    expect(report.issues).toContain("page 1, a form: an image (675×975) prints at 750 ppi; Lulu takes at most 600");
  });

  it("finds transparency: an image's alpha channel and an opacity below 1", async () => {
    const alpha = await book(async (doc, pdfPage) => {
      pdfPage.drawImage(await doc.embedPng(await pngWithAlpha(100, 100)), { x: 0, y: 0, width: 24, height: 24 });
    });
    expect((await checkPrintReady(alpha, trim)).issues).toContain(
      "page 1: an image has a soft mask (transparency) that isn't flattened",
    );

    const faded = await book(async (_doc, pdfPage) =>
      pdfPage.drawRectangle({ x: 0, y: 0, width: 50, height: 50, opacity: 0.9 }),
    );
    expect((await checkPrintReady(faded, trim)).issues).toEqual([
      "page 1: opacity below 1 (transparency) isn't flattened",
      "page 2: opacity below 1 (transparency) isn't flattened",
    ]);
  });

  it("needs every font embedded", async () => {
    const text = await book(async (doc, pdfPage) => {
      pdfPage.drawText("Mia", { x: 30, y: 30, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) });
    });
    const report = await checkPrintReady(text, trim);
    expect(report.issues).toContain("page 1: font Helvetica isn't embedded");
    expect(report.fonts).toEqual(["Helvetica (not embedded)"]);
  });
});

describe("printTrimIssues", () => {
  const square = { widthIn: 8.5, heightIn: 8.5 };

  it("needs Lulu's 0.125 in bleed and text at least 0.5 in inside the trim", () => {
    expect(printTrimIssues({ ...square, bleedIn: 0.125, safeMarginIn: 0.5 })).toEqual([]);
    expect(printTrimIssues({ ...square, bleedIn: 0.125, safeMarginIn: 0.375 })).toEqual([
      "trim.safeMarginIn: 0.375 in; Lulu needs text at least 0.5 in inside the trim",
    ]);
    expect(printTrimIssues({ ...square, bleedIn: 0.25, safeMarginIn: 0.75 })).toEqual([
      "trim.bleedIn: 0.25 in; Lulu prints a 0.125 in bleed",
    ]);
  });

  it("takes only the print sizes, in either orientation as listed", () => {
    const lulu = { bleedIn: 0.125, safeMarginIn: 0.5 };
    expect(printTrimIssues({ ...lulu, widthIn: 8.5, heightIn: 11 })).toEqual([]);
    expect(printTrimIssues({ ...lulu, widthIn: 11, heightIn: 8.5 })).toEqual([]);
    // Dream Adventure v3's 10 × 8 in landscape isn't a Lulu size; nor is a square a hair off 8.5 in.
    for (const size of [
      { widthIn: 10, heightIn: 8 },
      { widthIn: 8.625, heightIn: 8.5 },
    ])
      expect(printTrimIssues({ ...lulu, ...size })).toEqual([
        `trim: ${size.widthIn} × ${size.heightIn} in isn't a size we print; use Square (8.5 × 8.5 in), US Letter (8.5 × 11 in), US Letter Landscape (11 × 8.5 in)`,
      ]);
  });
});
