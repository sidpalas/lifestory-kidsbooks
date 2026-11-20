// The landing page's character demo draws a portrait by stacking static, pre-recoloured layers from
// public/marketing/looks (scripts/marketing-looks.ts renders them and checks each stack against /api/portrait).
// Browser-safe: no server, no session.
import { type Look, partAxesAt } from "@lifestory/core/contracts";

/**
 * The ages the demo offers: the youngest, whom parents and relatives most often buy picture books for (Sid,
 * 2026-11-20). Only these have layers.
 */
export const demoAges = ["baby", "toddler", "young-child"] as const satisfies ReadonlyArray<Look["age"]>;

const id = (option: string) => option.slice(option.indexOf(":") + 1);

/**
 * The look's layer files, bottom to top, as composeFigure stacks the portrait: the base, glasses, then the hair over
 * them, leaving out parts the age doesn't draw (a toddler's glasses) and a bald head's hair.
 */
export const demoLayers = (look: Look): ReadonlyArray<string> => {
  const at = `${look.age}-${id(look.face)}`;
  const drawn = partAxesAt(look.age);
  return [
    `${at}-skin-${id(look.skin)}.webp`,
    ...(drawn.includes("glasses") && look.glasses !== "glasses:none" ? [`${at}-glasses-${id(look.glasses)}.webp`] : []),
    ...(drawn.includes("hair") && look.hair !== "hair:none" ? [`${at}-hair-${id(look.hair)}-${id(look.hairColour)}.webp`] : []),
  ];
};
