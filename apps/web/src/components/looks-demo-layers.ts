// The landing page's character demo draws a portrait by stacking static, pre-recoloured layers from
// public/marketing/looks (scripts/marketing-looks.ts renders them and checks each stack against /api/portrait).
// Browser-safe: no server, no session.
import type { Look } from "@lifestory/core/contracts";

/** The ages the demo offers: the children a visitor most likely wants to try. Only these have layers. */
export const demoAges = ["young-child", "older-child"] as const satisfies ReadonlyArray<Look["age"]>;

const id = (option: string) => option.slice(option.indexOf(":") + 1);

/** The look's layer files, bottom to top, as composeFigure stacks the portrait: the base, glasses, then the hair over them. */
export const demoLayers = (look: Look): ReadonlyArray<string> => {
  const at = `${look.age}-${id(look.face)}`;
  return [
    `${at}-skin-${id(look.skin)}.webp`,
    ...(look.glasses === "glasses:none" ? [] : [`${at}-glasses-${id(look.glasses)}.webp`]),
    `${at}-hair-${id(look.hair)}-${id(look.hairColour)}.webp`,
  ];
};
