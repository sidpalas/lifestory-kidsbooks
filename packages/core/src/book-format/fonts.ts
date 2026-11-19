// Story fonts must be static, one file per weight (D24, D27): Chromium embeds a variable font in a PDF as Type 3
// glyph procedures, which print preflight flags, while a static font embeds as a real (CID TrueType) font.
import type { StoryManifest } from "./manifest.ts";

/**
 * Problems with the manifest's fonts for print: a font declared with a weight range, or a text style whose weight
 * no font file of its family declares (the browser would then synthesize or substitute it). Run on import, with
 * `isVariableFont` on each file's bytes, so stored manifests stay readable.
 */
export const staticFontIssues = (manifest: StoryManifest): ReadonlyArray<string> => [
  ...manifest.fonts.flatMap((font) =>
    font.weight === undefined || font.weight.includes(" ")
      ? [`${font.asset}: declare the one weight this static file has, not ${font.weight ? `a range (${font.weight})` : "none"}`]
      : [],
  ),
  ...(["title", "body"] as const).flatMap((name) => {
    const { fontFamily, weight } = manifest.textStyles[name];
    const declared = manifest.fonts.some(
      (font) => font.family === fontFamily && font.weight === String(weight) && (font.style ?? "normal") === "normal",
    );
    return declared ? [] : [`textStyles.${name}: no "${fontFamily}" file declares weight ${weight}`];
  }),
];

// WOFF2's known table tags, by the index a table directory entry stores (WOFF2 spec, section 5.1).
const KNOWN_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt  fpgm glyf loca prep CFF  VORG EBDT EBLC gasp hdmx kern LTSH PCLT VDMX " +
  "vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG  sbix acnt avar bdat bloc bsln cvar fdsc feat " +
  "fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .match(/.{4}\s?/g)!
  .map((tag) => tag.slice(0, 4));

/**
 * Whether a WOFF2 file is a variable font (it has an `fvar` table). Reads only the uncompressed table directory.
 * Throws if the bytes aren't WOFF2.
 */
export const isVariableFont = (woff2: Uint8Array): boolean => {
  const view = new DataView(woff2.buffer, woff2.byteOffset, woff2.byteLength);
  if (view.getUint32(0) !== 0x774f4632) throw new Error("not a WOFF2 file"); // "wOF2"
  const numTables = view.getUint16(12);
  let offset = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = view.getUint8(offset++);
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("bad UIntBase128 in WOFF2 table directory");
  };
  for (let t = 0; t < numTables; t++) {
    const flags = view.getUint8(offset++);
    let tag = KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      tag = String.fromCharCode(...woff2.subarray(offset, offset + 4));
      offset += 4;
    }
    if (tag === "fvar") return true;
    base128(); // origLength
    // glyf and loca carry a transformLength unless their transform version is 3 (null); every other table
    // carries one only when its version is non-zero.
    const version = flags >> 6;
    if (tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0) base128();
  }
  return false;
};
