// The prompts that draw a family into a book (D56), by the story's pinned prompt version, so a change of wording never
// redraws a published story differently. Configuration in code: the spike's wording (threads
// T-01a1fb83-7824-71fa-8625-bfe2dcc7ccda and T-8b52103b-ac29-4045-8048-12ef3cf41c6f).
import { ageOptions, type Age } from "./book-format/ages.ts";
import type { PhotoStyle } from "./book-format/manifest.ts";
import { eyeColours, hairColours, hairLengths, hairTextures, type Look, skinTones } from "./contracts.ts";

const ageWords = (age: Age) => ageOptions.find((option) => option.id === age)!.prompt;

const label = (options: ReadonlyArray<{ id: string; label: string }>, id: string | null) =>
  id === null ? null : options.find((option) => option.id === id)!.label.toLowerCase();

/** The hair in words: what's known of length, texture and colour; "as in the photo" when nothing is. */
export const hairWords = (look: Look) => {
  if (look.hairLength === "none") return "no hair (bald)";
  const words = [
    label(hairLengths, look.hairLength),
    label(hairTextures, look.hairTexture),
    label(hairColours, look.hairColour),
  ].filter((word) => word !== null);
  return words.length === 0 ? "the hair as in the photo" : `${words.join(", ")} hair`;
};

/** The rest of the look in words, each only when known: eyes, skin tone, freckles, glasses. */
export const lookWords = (look: Look) => {
  const words = [
    look.eyeColour && `Eyes: ${label(eyeColours, look.eyeColour)}.`,
    look.skinTone && `Skin tone: ${label(skinTones, look.skinTone)}.`,
    look.freckles !== null && (look.freckles ? "Freckles." : "No freckles."),
    look.glasses !== null && (look.glasses ? "Glasses, as in the photo." : "No glasses."),
  ].filter(Boolean);
  return words.length === 0 ? "" : ` ${words.join(" ")}`;
};

/** v1's sheet and revise prompts, which v2 keeps. */
const sheetPrompts = {
  /** References: the photo, then the story's style reference. */
  /**
   * References: the main photo, the person's extra photos (D56, optional), then the story's style reference. With no
   * extra photos the wording is as before, so a sheet from one photo is drawn the same way.
   */
  sheet: (input: { style: PhotoStyle; age: Age; outfit: string; look: Look; extraPhotos?: number }) =>
    (input.extraPhotos
      ? `The first ${input.extraPhotos + 1} images are photos of the same person, with different expressions and ` +
        `from different sides. The last image shows the style of a children's picture book. `
      : `The first image is a photo of a person. The second image shows the style of a children's picture book. `) +
    `Draw a character sheet of this person as ${ageWords(input.age)}, in the book's style ` +
    `(${input.style.styleWords}): front, three-quarter and back views side by side, full body, on a plain white ` +
    `background. Keep the face shape, eyes, skin tone and features from the ${input.extraPhotos ? "photos" : "photo"} so the person is recognisable, ` +
    `drawn at that age. Hair: ${hairWords(input.look)}.${lookWords(input.look)} Outfit: ${input.outfit}. No text, no frame.`,
  /** References: the sheet just drawn. The parent judges the likeness across these (D56). */
  expressions: (input: { style: PhotoStyle }) =>
    `This is a character sheet for a children's picture book. Draw the same character's head and shoulders six ` +
    `times in a row, facing three-quarters toward the viewer, with these expressions from left to right: a big open ` +
    `grin, a gentle smile, neutral, eyes closed as if asleep, sad, surprised. Keep the face shape, eyes, hair, skin ` +
    `tone, age and drawing style exactly as on the sheet (${input.style.styleWords}). Plain white background, no ` +
    `text, no frame.`,
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
  "photo-hero-v3": {
    ...sheetPrompts,
    /**
     * References: the page reference, the sheet, then the person's expressions when they have them (sheets drawn
     * before 2026-11-25 don't).
     */
    figure: (input: { style: PhotoStyle; note?: string; expressions?: boolean }) =>
      `The first image is part of a page of a children's picture book, with a bald placeholder figure on it. The ` +
      `second image is a character sheet` +
      (input.expressions ? `, and the third shows the same character's face in several expressions` : "") +
      `. Redraw the placeholder figure as the character on the sheet, in exactly the same pose, position, size and ` +
      `framing, in the book's style (${input.style.styleWords}). Take the face, hair and skin tone from the sheet` +
      (input.expressions
        ? `, and give the face the expression the placeholder shows on this page, drawn as in the expressions image`
        : "") +
      `. Keep the clothes, hat or helmet the placeholder wears on this page, with their shapes and colours; don't ` +
      `dress the figure in the sheet's outfit. Output only that character on a transparent background: don't draw ` +
      `the scenery, other figures, or anything behind or around the figure.` +
      (input.note ? ` The parent asked for this change: ${input.note}.` : ""),
  },
} as const satisfies Record<PhotoStyle["promptVersion"], unknown>;
