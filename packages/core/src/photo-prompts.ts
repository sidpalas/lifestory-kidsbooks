// The prompts that draw a family into a book (D56), by the story's pinned prompt version, so a change of wording never
// redraws a published story differently. Configuration in code: the spike's wording (threads
// T-01a1fb83-7824-71fa-8625-bfe2dcc7ccda and T-8b52103b-ac29-4045-8048-12ef3cf41c6f).
import { ageOptions, type Age } from "./book-format/ages.ts";
import type { PhotoStyle } from "./book-format/manifest.ts";
import { type Hair, hairColours, hairLengths, hairTextures } from "./contracts.ts";

const ageWords = (age: Age) => ageOptions.find((option) => option.id === age)!.prompt;

export const hairWords = (hair: Hair | null) => {
  if (!hair) return "the hair as in the photo";
  if (hair.length === "none") return "no hair (bald)";
  const colour = hairColours.find((c) => c.id === hair.colour)!.label.toLowerCase();
  const length = hairLengths.find((l) => l.id === hair.length)!.label.toLowerCase();
  const texture = hairTextures.find((t) => t.id === hair.texture)!.label.toLowerCase();
  return `${length}, ${texture}, ${colour} hair`;
};

/** v1's sheet and revise prompts, which v2 keeps. */
const sheetPrompts = {
  /** References: the photo, then the story's style reference. */
  sheet: (input: { style: PhotoStyle; age: Age; outfit: string; hair: Hair | null }) =>
    `The first image is a photo of a person. The second image shows the style of a children's picture book. ` +
    `Draw a character sheet of this person as ${ageWords(input.age)}, in the book's style ` +
    `(${input.style.styleWords}): front, three-quarter and back views side by side, full body, on a plain white ` +
    `background. Keep the face shape, eyes, skin tone and features from the photo so the person is recognisable, ` +
    `drawn at that age. Hair: ${hairWords(input.hair)}. Outfit: ${input.outfit}. No text, no frame.`,
  /** References: the current sheet. One note per call (D56: preview changes edit the current sheet). */
  revise: (note: string) =>
    `This is a character sheet for a children's picture book. Change only this: ${note}. Keep everything else ` +
    `exactly as it is: the three views, poses, outfit, proportions, colours and drawing style.`,
};

export const photoPrompts = {
  "photo-hero-v1": {
    ...sheetPrompts,
    /** References: the page reference (plate and bald figures, cropped to the window), then the sheet. */
    figure: (input: { style: PhotoStyle; note?: string }) =>
      `The first image is part of a page of a children's picture book, with a bald placeholder figure on it. The ` +
      `second image is a character sheet. Redraw the placeholder figure as the character on the sheet, in exactly ` +
      `the same pose, position, size and framing, dressed as on the sheet, in the book's style ` +
      `(${input.style.styleWords}). Output only that character on a transparent background: don't draw the ` +
      `scenery, other figures, or anything behind or around the figure.` +
      (input.note ? ` The parent asked for this change: ${input.note}.` : ""),
  },
  "photo-hero-v2": {
    ...sheetPrompts,
    /** References: the page reference (plate and bald figures, cropped to the window), then the sheet. */
    figure: (input: { style: PhotoStyle; note?: string }) =>
      `The first image is part of a page of a children's picture book, with a bald placeholder figure on it. The ` +
      `second image is a character sheet. Redraw the placeholder figure as the character on the sheet, in exactly ` +
      `the same pose, position, size and framing, in the book's style (${input.style.styleWords}). Take the face, ` +
      `hair and skin tone from the sheet. Keep the clothes, hat or helmet the placeholder wears on this page, with ` +
      `their shapes and colours; don't dress the figure in the sheet's outfit. Output only that character on a ` +
      `transparent background: don't draw the scenery, other figures, or anything behind or around the figure.` +
      (input.note ? ` The parent asked for this change: ${input.note}.` : ""),
  },
} as const satisfies Record<PhotoStyle["promptVersion"], unknown>;
