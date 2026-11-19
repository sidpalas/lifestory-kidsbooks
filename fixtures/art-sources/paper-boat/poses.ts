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
  { role: "hero", pose: "kneel", faces: ["round", "oval"], notSkin: [[0, 790, 160, 1000], [395, 845, 640, 1000]] },
  { role: "hero", pose: "sit", faces: ["round", "oval"], notSkin: [[470, 812, 1000, 1000]] },
  { role: "grownup", pose: "back", faces: ["round"], notSkin: [[0, 895, 1000, 1000]] },
  { role: "grownup", pose: "sit", faces: ["round", "oval"], occluder: [250, 0, 1000, 420], notSkin: [[80, 850, 418, 1000], [550, 850, 1000, 1000]] },
];
