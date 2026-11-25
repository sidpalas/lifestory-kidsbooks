// The look's attributes (D56) with their options, for the photo step's confirmation and the People page (D61).
import { eyeColours, hairColours, hairLengths, hairTextures, type LookKey, skinTones } from "@lifestory/core/contracts";

/**
 * The look's attributes as the confirmation shows them: each option with its swatch or its description (hair length
 * and texture), if it has one.
 */
const yesNo = [
  { id: true, label: "Yes" },
  { id: false, label: "No" },
] as const;
export const lookFields: ReadonlyArray<{
  key: LookKey;
  label: string;
  options: ReadonlyArray<{ id: string | boolean; label: string; swatch?: string; description?: string }>;
}> = [
  { key: "hairColour", label: "Hair colour", options: hairColours },
  { key: "hairLength", label: "Hair length", options: hairLengths },
  { key: "hairTexture", label: "Hair texture", options: hairTextures },
  { key: "eyeColour", label: "Eyes", options: eyeColours },
  { key: "skinTone", label: "Skin tone", options: skinTones },
  { key: "freckles", label: "Freckles", options: yesNo },
  { key: "glasses", label: "Glasses", options: yesNo },
];
