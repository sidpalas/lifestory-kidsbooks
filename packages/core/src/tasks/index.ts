import { importTask } from "../imports/task.ts";
import { generatePart } from "./generate-part.ts";
import { renderProof } from "./render-proof.ts";
import { writeSampleFile } from "./sample-file.ts";
import { sweepStorage } from "./sweep-storage.ts";

export { generatePart } from "./generate-part.ts";
export { importTask } from "../imports/task.ts";
export { proofObjectKey, renderProof } from "./render-proof.ts";
export { writeSampleFile } from "./sample-file.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [writeSampleFile, renderProof, sweepStorage, generatePart, importTask] as const;
