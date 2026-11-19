// What a print-on-demand provider needs from a book's interior PDF, and a check that a PDF meets it (D35). The
// requirements are Lulu's, the provider the brief names, from its public docs (checked 2026-11-19):
//  - "PDF Creation Settings" (help.lulu.com, article 64000255519, modified 2026-09-25) and the Lulu Print API guide:
//    single pages of one size, trim + 0.125 in bleed on every side, images 300 ppi (600 at most), every font embedded,
//    transparency flattened, sRGB preferred, no crop or bleed marks, no security.
//  - Lulu's Interior Job Options (attached to that article): PDF 1.3 compatibility with transparency not allowed,
//    colours left unchanged, 8-bit images, layers not included, PDF/X checks off (so PDF/X isn't required).
//  - The Print API's interior validation: at least 2 pages, all pages the same size, fonts embedded.
//  - "What is Full Bleed?" (help.lulu.com, article 64000255584): text and other important elements 0.5 in inside the
//    trim, because trimming can vary by up to 0.125 in.
// TrimBox and BleedBox aren't on Lulu's list, but they are how a PDF states its trim to every prepress tool (PDF/X
// requires them), and they cost nothing, so print-ready files carry them and the check requires them.
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFObject,
} from "pdf-lib";

/** Lulu's interior file requirements, as numbers the check uses. */
export const LULU_INTERIOR = {
  bleedIn: 0.125,
  /** Text stays this far inside the trim (Sid, 2026-11-19: required of new story versions, D35). */
  safeMarginIn: 0.5,
  minPages: 2,
  minPpi: 300,
  maxPpi: 600,
} as const;

export interface TrimSize {
  readonly widthIn: number;
  readonly heightIn: number;
}

/**
 * What keeps a story's trim from printing at Lulu: a bleed other than Lulu's, or a safe margin narrower than Lulu's.
 * Checked when a story version is imported, so versions stored before the rule stay readable.
 */
export const printTrimIssues = (trim: { readonly bleedIn: number; readonly safeMarginIn: number }): ReadonlyArray<string> => [
  ...(trim.bleedIn === LULU_INTERIOR.bleedIn ? [] : [`trim.bleedIn: ${trim.bleedIn} in; Lulu prints a ${LULU_INTERIOR.bleedIn} in bleed`]),
  ...(trim.safeMarginIn >= LULU_INTERIOR.safeMarginIn
    ? []
    : [`trim.safeMarginIn: ${trim.safeMarginIn} in; Lulu needs text at least ${LULU_INTERIOR.safeMarginIn} in inside the trim`]),
];

export interface PrintReadyReport {
  /** Everything that keeps the PDF from meeting the requirements; empty when it's print-ready. */
  readonly issues: ReadonlyArray<string>;
  readonly pages: number;
  /** Base font names with how each is embedded, such as `Literata-Regular (TrueType)`. */
  readonly fonts: ReadonlyArray<string>;
  /** Each image drawn, with its effective resolution where it's drawn. */
  readonly images: ReadonlyArray<{ readonly page: number; readonly pixels: string; readonly ppi: number; readonly colourSpace: string; readonly filter: string }>;
}

const pt = (inches: number) => inches * 72;
/** Boxes match within half a point (0.007 in): Chromium writes page sizes rounded to whole points. */
const TOLERANCE_PT = 0.5;

/**
 * Sets each page's TrimBox to the trim, centred in the page, and its BleedBox to the whole page (trim + bleed), and
 * returns the rewritten PDF. Page dictionaries stay uncompressed, as Chromium writes them.
 */
export const setPrintBoxes = async (pdf: Uint8Array, trim: TrimSize): Promise<Uint8Array> => {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  for (const page of doc.getPages()) {
    const media = page.getMediaBox();
    const bleedX = (media.width - pt(trim.widthIn)) / 2;
    const bleedY = (media.height - pt(trim.heightIn)) / 2;
    page.setBleedBox(media.x, media.y, media.width, media.height);
    page.setTrimBox(media.x + bleedX, media.y + bleedY, pt(trim.widthIn), pt(trim.heightIn));
  }
  return doc.save({ useObjectStreams: false, updateFieldAppearances: false });
};

/** Checks `pdf`, the interior of a book trimmed to `trim`, against Lulu's interior requirements (LULU_INTERIOR). */
export const checkPrintReady = async (pdf: Uint8Array, trim: TrimSize): Promise<PrintReadyReport> => {
  const issues: string[] = [];
  const fonts = new Set<string>();
  const images: Array<PrintReadyReport["images"][number]> = [];
  const doc = await PDFDocument.load(pdf, { ignoreEncryption: true, updateMetadata: false });
  const { context } = doc;
  const lookup = (object: PDFObject | undefined): PDFObject | undefined =>
    object instanceof PDFRef ? context.lookup(object) : object;
  const dictOf = (object: PDFObject | undefined) => {
    const value = lookup(object);
    return value instanceof PDFDict ? value : value instanceof PDFStream ? value.dict : undefined;
  };
  const num = (object: PDFObject | undefined) => {
    const value = lookup(object);
    return value instanceof PDFNumber ? value.asNumber() : undefined;
  };
  const name = (object: PDFObject | undefined) => {
    const value = lookup(object);
    return value instanceof PDFName ? value.decodeText() : undefined;
  };
  const box = (object: PDFObject | undefined) => {
    const value = lookup(object);
    if (!(value instanceof PDFArray) || value.size() !== 4) return undefined;
    const [x0, y0, x1, y1] = value.asArray().map((item) => num(item) ?? Number.NaN) as [number, number, number, number];
    return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
  };
  type Box = NonNullable<ReturnType<typeof box>>;
  const sameBox = (a: Box, b: Box) =>
    Math.abs(a.x0 - b.x0) <= TOLERANCE_PT && Math.abs(a.y0 - b.y0) <= TOLERANCE_PT && Math.abs(a.x1 - b.x1) <= TOLERANCE_PT && Math.abs(a.y1 - b.y1) <= TOLERANCE_PT;
  const inches = (b: Box) => `${+((b.x1 - b.x0) / 72).toFixed(3)} × ${+((b.y1 - b.y0) / 72).toFixed(3)} in`;

  if (doc.isEncrypted) issues.push("the PDF is encrypted; Lulu takes no security or password protection");
  if (doc.catalog.has(PDFName.of("OCProperties"))) issues.push("the PDF has layers (optional content); Lulu needs them flattened");

  const pages = doc.getPages();
  if (pages.length < LULU_INTERIOR.minPages) issues.push(`${pages.length} pages; Lulu needs at least ${LULU_INTERIOR.minPages}`);

  const bleed = pt(LULU_INTERIOR.bleedIn);
  const expectedMedia: Box = { x0: 0, y0: 0, x1: pt(trim.widthIn) + 2 * bleed, y1: pt(trim.heightIn) + 2 * bleed };

  // Every resource dictionary is walked once, wherever it's used; images are measured where each is drawn.
  const seen = new Set<PDFObject>();
  const once = (object: PDFObject | undefined) => {
    if (!object || seen.has(object)) return false;
    seen.add(object);
    return true;
  };

  const colourSpaceName = (object: PDFObject | undefined): { label: string; ok: boolean } => {
    const value = lookup(object);
    const simple = name(value);
    if (simple) return { label: simple, ok: simple === "DeviceRGB" || simple === "DeviceGray" };
    if (value instanceof PDFArray) {
      const family = name(value.get(0));
      if (family === "ICCBased") {
        const n = num(dictOf(value.get(1))?.get(PDFName.of("N")));
        return { label: `ICCBased/${n}`, ok: n === 1 || n === 3 };
      }
      if (family === "Indexed") {
        const base = colourSpaceName(value.get(1));
        return { label: `Indexed/${base.label}`, ok: base.ok };
      }
      return { label: family ?? "unknown", ok: false };
    }
    return { label: "unknown", ok: false };
  };

  const matrixOf = (object: PDFObject | undefined): Matrix6 => {
    const value = lookup(object);
    return value instanceof PDFArray && value.size() === 6 ? (value.asArray().map((item) => num(item) ?? 0) as Matrix6) : [1, 0, 0, 1, 0, 0];
  };

  const checkFont = (where: string, fontObject: PDFObject | undefined) => {
    const font = dictOf(fontObject);
    if (!font || !once(font)) return;
    const subtype = name(font.get(PDFName.of("Subtype")));
    const baseFont = name(font.get(PDFName.of("BaseFont"))) ?? "(unnamed)";
    const label = baseFont.replace(/^[A-Z]{6}\+/, "");
    if (subtype === "Type3") {
      fonts.add(`${label} (Type 3)`);
      issues.push(`${where}: font ${label} is Type 3 (glyphs drawn as procedures), which prepress rejects; embed a static font`);
      return;
    }
    const descendants = lookup(font.get(PDFName.of("DescendantFonts")));
    const descendant = subtype === "Type0" ? dictOf(descendants instanceof PDFArray ? descendants.get(0) : undefined) : font;
    const descriptor = dictOf(descendant?.get(PDFName.of("FontDescriptor")));
    const program = ["FontFile2", "FontFile3", "FontFile"].find((key) => descriptor?.has(PDFName.of(key)));
    fonts.add(`${label} (${program === "FontFile2" ? "TrueType" : program === "FontFile3" ? "CFF/OpenType" : program === "FontFile" ? "Type 1" : "not embedded"})`);
    if (!program) issues.push(`${where}: font ${label} isn't embedded`);
  };

  const checkExtGState = (where: string, stateObject: PDFObject | undefined) => {
    const state = dictOf(stateObject);
    if (!state || !once(state)) return;
    const smask = lookup(state.get(PDFName.of("SMask")));
    if (smask && name(smask) !== "None") issues.push(`${where}: a soft mask (transparency) isn't flattened`);
    for (const key of ["CA", "ca"]) {
      const alpha = num(state.get(PDFName.of(key)));
      if (alpha !== undefined && alpha < 1) issues.push(`${where}: opacity below 1 (transparency) isn't flattened`);
    }
    const blend = lookup(state.get(PDFName.of("BM")));
    const blendName = name(blend) ?? (blend instanceof PDFArray ? name(blend.get(0)) : undefined);
    if (blendName && blendName !== "Normal" && blendName !== "Compatible") issues.push(`${where}: blend mode ${blendName} (transparency) isn't flattened`);
  };

  const checkGroup = (where: string, owner: PDFDict) => {
    const group = dictOf(owner.get(PDFName.of("Group")));
    if (group && name(group.get(PDFName.of("S"))) === "Transparency") issues.push(`${where}: a transparency group isn't flattened`);
  };

  const checkImage = (where: string, image: PDFDict) => {
    const isMask = image.get(PDFName.of("ImageMask"))?.toString() === "true";
    if (image.has(PDFName.of("SMask")) || image.has(PDFName.of("SMaskInData"))) issues.push(`${where}: an image has a soft mask (transparency) that isn't flattened`);
    const bits = num(image.get(PDFName.of("BitsPerComponent")));
    if (!isMask && bits !== undefined && bits !== 8) issues.push(`${where}: an image has ${bits} bits per channel; Lulu wants 8`);
    if (!isMask) {
      const space = colourSpaceName(image.get(PDFName.of("ColorSpace")));
      if (!space.ok && name(image.get(PDFName.of("Filter"))) !== "JPXDecode") issues.push(`${where}: an image is in ${space.label}; print-ready files use sRGB or grey`);
    }
  };

  /** Walks one content stream with its resources, tracking the transformation to measure each image drawn. */
  const walk = (where: string, page: number, content: Uint8Array, resources: PDFDict | undefined, ctm: Matrix, depth: number) => {
    const xobjects = dictOf(resources?.get(PDFName.of("XObject")));
    for (const [, value] of dictOf(resources?.get(PDFName.of("Font")))?.entries() ?? []) checkFont(where, value);
    for (const [, value] of dictOf(resources?.get(PDFName.of("ExtGState")))?.entries() ?? []) checkExtGState(where, value);
    for (const [, value] of dictOf(resources?.get(PDFName.of("Pattern")))?.entries() ?? []) {
      const pattern = dictOf(value);
      if (pattern && once(pattern)) {
        const patternResources = dictOf(pattern.get(PDFName.of("Resources")));
        const stream = lookup(value);
        if (stream instanceof PDFRawStream && depth < 8) {
          // A tiling pattern's cells live in pattern space, which its Matrix maps to the page's default space.
          const inner: Matrix = { current: matrixOf(pattern.get(PDFName.of("Matrix"))), stack: [] };
          walk(`${where}, a pattern`, page, streamBytes(stream), patternResources, inner, depth + 1);
        }
      }
    }
    for (const { operator, operands } of operations(content)) {
      if (operator === "q") ctm.stack.push(ctm.current);
      else if (operator === "Q") ctm.current = ctm.stack.pop() ?? ctm.current;
      else if (operator === "cm" && operands.length === 6) ctm.current = multiply(operands as Matrix6, ctm.current);
      else if (operator === "BI") issues.push(`${where}: an inline image can't be measured`);
      else if (operator === "Do" && typeof operands[0] === "string") {
        const object = lookup(xobjects?.get(PDFName.of(operands[0])));
        if (!(object instanceof PDFRawStream)) continue;
        const subtype = name(object.dict.get(PDFName.of("Subtype")));
        if (subtype === "Image") {
          if (once(object)) checkImage(where, object.dict);
          const [a, b, c, d] = ctm.current;
          const widthIn = Math.hypot(a, b) / 72;
          const heightIn = Math.hypot(c, d) / 72;
          const w = num(object.dict.get(PDFName.of("Width"))) ?? 0;
          const h = num(object.dict.get(PDFName.of("Height"))) ?? 0;
          const ppi = Math.round(Math.min(w / widthIn, h / heightIn));
          images.push({
            page,
            pixels: `${w}×${h}`,
            ppi,
            colourSpace: colourSpaceName(object.dict.get(PDFName.of("ColorSpace"))).label,
            filter: name(object.dict.get(PDFName.of("Filter"))) ?? "none",
          });
          if (ppi < LULU_INTERIOR.minPpi - 1) issues.push(`${where}: an image (${w}×${h}) prints at ${ppi} ppi; Lulu needs ${LULU_INTERIOR.minPpi}`);
          if (ppi > LULU_INTERIOR.maxPpi + 1) issues.push(`${where}: an image (${w}×${h}) prints at ${ppi} ppi; Lulu takes at most ${LULU_INTERIOR.maxPpi}`);
        } else if (subtype === "Form" && depth < 8) {
          checkGroup(`${where}, a form`, object.dict);
          const inner: Matrix = { current: multiply(matrixOf(object.dict.get(PDFName.of("Matrix"))), ctm.current), stack: [] };
          walk(`${where}, a form`, page, streamBytes(object), dictOf(object.dict.get(PDFName.of("Resources"))), inner, depth + 1);
        }
      }
    }
  };

  const sizes = new Set<string>();
  pages.forEach((page, i) => {
    const where = `page ${i + 1}`;
    const node = page.node;
    const media = box(node.MediaBox());
    if (!media) {
      issues.push(`${where}: no MediaBox`);
      return;
    }
    sizes.add(inches(media));
    if (!sameBox(media, expectedMedia)) {
      issues.push(`${where}: page is ${inches(media)}; a ${trim.widthIn} × ${trim.heightIn} in book with Lulu's ${LULU_INTERIOR.bleedIn} in bleed needs ${inches(expectedMedia)}`);
    }
    const trimBox = box(node.get(PDFName.of("TrimBox")));
    const expectedTrim: Box = { x0: media.x0 + bleed, y0: media.y0 + bleed, x1: media.x1 - bleed, y1: media.y1 - bleed };
    if (!trimBox) issues.push(`${where}: no TrimBox`);
    else if (!sameBox(trimBox, expectedTrim)) issues.push(`${where}: TrimBox is ${inches(trimBox)}, not the ${trim.widthIn} × ${trim.heightIn} in trim inset by the bleed`);
    const bleedBox = box(node.get(PDFName.of("BleedBox")));
    if (!bleedBox) issues.push(`${where}: no BleedBox`);
    else if (!sameBox(bleedBox, media)) issues.push(`${where}: BleedBox ${inches(bleedBox)} isn't the whole page`);
    const cropBox = box(node.get(PDFName.of("CropBox")));
    if (cropBox && !sameBox(cropBox, media)) issues.push(`${where}: CropBox ${inches(cropBox)} hides part of the page`);
    if ((page.getRotation().angle % 360) !== 0) issues.push(`${where}: rotated ${page.getRotation().angle}°`);
    checkGroup(where, node);
    const contents = lookup(node.get(PDFName.of("Contents")));
    const streams = contents instanceof PDFArray ? contents.asArray().map(lookup) : [contents];
    const bytes = Buffer.concat(streams.filter((s): s is PDFRawStream => s instanceof PDFRawStream).map((s) => Buffer.concat([streamBytes(s), Buffer.from("\n")])));
    walk(where, i + 1, bytes, node.Resources(), { current: [1, 0, 0, 1, 0, 0], stack: [] }, 0);
  });
  if (sizes.size > 1) issues.push(`pages differ in size (${[...sizes].join(", ")}); Lulu needs one size`);

  return { issues: [...new Set(issues)], pages: pages.length, fonts: [...fonts], images };
};

type Matrix6 = [number, number, number, number, number, number];
interface Matrix {
  current: Matrix6;
  stack: Matrix6[];
}
/** m × n for PDF's row-vector matrices: applying m, then n. */
const multiply = ([a, b, c, d, e, f]: Matrix6, [A, B, C, D, E, F]: Matrix6): Matrix6 => [
  a * A + b * C,
  a * B + b * D,
  c * A + d * C,
  c * B + d * D,
  e * A + f * C + E,
  e * B + f * D + F,
];

const streamBytes = (stream: PDFRawStream) => {
  const decoded = decodePDFRawStream(stream).decode();
  return Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength);
};

const isSpace = (c: number) => c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
const isDelimiter = (c: number) => "()<>[]{}/%".includes(String.fromCharCode(c));

/**
 * The operators of a content stream with their operands: numbers and names (as strings); strings, arrays and
 * dictionaries are skipped, since the check only needs `q`, `Q`, `cm`, `Do` and `BI`.
 */
function* operations(bytes: Uint8Array): Generator<{ operator: string; operands: Array<number | string | null> }> {
  let operands: Array<number | string | null> = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const c = bytes[i]!;
    if (isSpace(c)) i++;
    else if (c === 0x25 /* % */) while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++;
    else if (c === 0x28 /* ( */) {
      let depth = 0;
      for (; i < n; i++) {
        const s = bytes[i]!;
        if (s === 0x5c /* \ */) i++;
        else if (s === 0x28) depth++;
        else if (s === 0x29 && --depth === 0) break;
      }
      i++;
      operands.push(null);
    } else if (c === 0x3c /* < */ && bytes[i + 1] !== 0x3c) {
      while (i < n && bytes[i] !== 0x3e) i++;
      i++;
      operands.push(null);
    } else if (c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d || c === 0x7b || c === 0x7d) {
      // Dictionary and array brackets: their contents are tokens like any other, and the operators that take them
      // (TJ, d, BDC…) aren't ones the check uses.
      i += c === 0x3c || c === 0x3e ? 2 : 1;
      operands.push(null);
    } else if (c === 0x2f /* / */) {
      let j = i + 1;
      while (j < n && !isSpace(bytes[j]!) && !isDelimiter(bytes[j]!)) j++;
      operands.push(Buffer.from(bytes.subarray(i + 1, j)).toString("latin1").replace(/#([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))));
      i = j;
    } else {
      let j = i;
      while (j < n && !isSpace(bytes[j]!) && !isDelimiter(bytes[j]!)) j++;
      if (j === i) j++;
      const token = Buffer.from(bytes.subarray(i, j)).toString("latin1");
      i = j;
      const value = Number(token);
      if (token !== "" && !Number.isNaN(value) && /^[+\-.\d]/.test(token)) operands.push(value);
      else {
        yield { operator: token, operands };
        operands = [];
        if (token === "BI") {
          // Skip the inline image's data up to `EI` between whitespace.
          while (i < n && !(isSpace(bytes[i - 1] ?? 0x20) && bytes[i] === 0x45 && bytes[i + 1] === 0x49 && (i + 2 >= n || isSpace(bytes[i + 2]!)))) i++;
          i += 2;
        }
      }
    }
  }
}
