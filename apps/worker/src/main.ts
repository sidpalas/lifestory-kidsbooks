// The Absurd worker: pulls tasks from Postgres and runs them as Effect programs
// through the shared server runtime.
import {
  beatWorker,
  forgetWorker,
  HEARTBEAT_INTERVAL_MS,
  Jobs,
  makeServerRuntime,
  ObjectStorage,
  type ServerServices,
  sweepStorage,
  type TaskDefinition,
  tasks,
} from "@lifestory/core";
import { Effect, Schema } from "effect";

const runtime = makeServerRuntime();
const { client } = await runtime.runPromise(Jobs.use(Effect.succeed));
await runtime.runPromise(ObjectStorage.use((storage) => storage.ensureBucket));

// Each task's params and requirements differ; the loop only needs that the runtime provides them all.
for (const task of tasks as ReadonlyArray<TaskDefinition<any, unknown, unknown, ServerServices>>) {
  const decode = Schema.decodeUnknownEffect(task.params);
  client.registerTask({ name: task.name, queue: Jobs.queue }, (params, ctx) =>
    runtime.runPromise(decode(params).pipe(Effect.flatMap((decoded) => task.run(decoded, ctx)))),
  );
}

const worker = await client.startWorker({ concurrency: 4, pollInterval: 0.5 });
console.log(`worker started: queue=${Jobs.queue} tasks=${tasks.map((t) => t.name).join(",")}`);

// Absurd has no scheduler (D4), so each worker spawns the storage sweep (D31) at start and every 6 hours. The
// idempotency key names the 6-hour period, so several workers and restarts still make one run per period.
const SWEEP_PERIOD_MS = 6 * 60 * 60 * 1000;
const spawnSweep = () =>
  runtime
    .runPromise(
      Jobs.use((jobs) =>
        jobs.spawn(sweepStorage, {}, { idempotencyKey: `storage.sweep:${Math.floor(Date.now() / SWEEP_PERIOD_MS)}` }),
      ),
    )
    .catch((error) => console.error("storage sweep: spawn failed", error));
void spawnSweep();
const sweepTimer = setInterval(() => void spawnSweep(), SWEEP_PERIOD_MS);

// /api/health lists workers that beat recently, so the post-deploy check knows a worker runs the new commit.
const workerID = crypto.randomUUID();
const beat = () =>
  runtime.runPromise(beatWorker(workerID)).catch((error) => console.error("worker heartbeat failed", error));
await beat();
const beatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

const shutdown = async (signal: string) => {
  console.log(`worker stopping (${signal})`);
  clearInterval(sweepTimer);
  clearInterval(beatTimer);
  // First, while the process surely lives (under `node --watch`, systemd kills it once the watcher exits): a stopped
  // worker stops counting at once, and the e2e tests refuse to run next to another worker (e2e/global-setup.ts).
  await runtime.runPromise(forgetWorker(workerID)).catch((error) => console.error("worker heartbeat cleanup failed", error));
  await worker.close();
  await runtime.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
