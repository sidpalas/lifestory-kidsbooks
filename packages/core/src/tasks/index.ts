import { castingTask } from "../imports/casting-task.ts";
import { importTask } from "../imports/task.ts";
import { generatePart, recutPart } from "./generate-part.ts";
import { renderProof } from "./render-proof.ts";
import { sweepStorage } from "./sweep-storage.ts";

export { generatePart, recutPart } from "./generate-part.ts";
export { importTask } from "../imports/task.ts";
export { proofObjectKey, renderProof } from "./render-proof.ts";
export { sweepStorage } from "./sweep-storage.ts";

/** Every task the worker runs. */
export const tasks = [renderProof, sweepStorage, generatePart, recutPart, importTask, castingTask] as const;
