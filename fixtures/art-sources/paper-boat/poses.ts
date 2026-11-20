// The poses of Paper Boat v3 (raw/v3/<role>-<pose>-<face>.png). `faces` lists the faces drawn; a pose seen from
// behind draws one and both face types use it. `occluder` is the area of the raised arm, in thousandths of the crop.
export interface Pose {
  readonly role: "hero" | "grownup";
  readonly pose: string;
  readonly faces: ReadonlyArray<"round" | "oval">;
  readonly flip?: boolean;
  readonly occluder?: readonly [number, number, number, number];
  /** Shoes, which the colour-based skin mask takes for skin: kept out of the mask by hand, in thousandths of the crop. */
  readonly notSkin: ReadonlyArray<readonly [number, number, number, number]>;
}

export const POSES: ReadonlyArray<Pose> = [
  { role: "hero", pose: "point", faces: ["round", "oval"], flip: true, notSkin: [[0, 868, 1000, 1000]] },
  {
    role: "hero",
    pose: "kneel",
    faces: ["round", "oval"],
    notSkin: [
      [0, 790, 160, 1000],
      [395, 845, 640, 1000],
    ],
  },
  { role: "hero", pose: "sit", faces: ["round", "oval"], notSkin: [[470, 812, 1000, 1000]] },
  { role: "grownup", pose: "back", faces: ["round"], notSkin: [[0, 895, 1000, 1000]] },
  {
    role: "grownup",
    pose: "sit",
    faces: ["round", "oval"],
    occluder: [250, 0, 1000, 420],
    notSkin: [
      [80, 850, 418, 1000],
      [550, 850, 1000, 1000],
    ],
  },
];

/** D43's options (D43: 2026-11-19T19:30). */
export const D43_HAIR = ["hair:buzz", "hair:ponytail", "hair:braids", "hair:afro", "hair:locs", "hair:bun"];
export const D43_FACIAL_HAIR = ["facial-hair:stubble", "facial-hair:moustache", "facial-hair:beard"];
/**
 * The D43 parts published in v5's manifest (production's v5 is this repo's first v3, 2026-11-19), one pose per role
 * to prove them; every other D43 part is in additions/2.json (D41).
 */
export const IN_MANIFEST: Record<string, ReadonlyArray<string>> = {
  "hero/point/round": D43_HAIR,
  "grownup/sit/round": D43_FACIAL_HAIR,
};
