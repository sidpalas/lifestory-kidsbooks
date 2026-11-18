// The Absurd worker: pulls tasks from Postgres and runs them as Effect programs
// through the shared server runtime.
import { Jobs, makeServerRuntime, ObjectStorage, tasks } from "@lifestory/core";
import { Effect, Schema } from "effect";

const runtime = makeServerRuntime();
const { client } = await runtime.runPromise(Jobs.use(Effect.succeed));
await runtime.runPromise(ObjectStorage.use((storage) => storage.ensureBucket));

for (const task of tasks) {
  const decode = Schema.decodeUnknownEffect(task.params);
  client.registerTask({ name: task.name, queue: Jobs.queue }, (params, ctx) =>
    runtime.runPromise(decode(params).pipe(Effect.flatMap((decoded) => task.run(decoded, ctx)))),
  );
}

const worker = await client.startWorker({ concurrency: 4, pollInterval: 0.5 });
console.log(`worker started: queue=${Jobs.queue} tasks=${tasks.map((t) => t.name).join(",")}`);

const shutdown = async (signal: string) => {
  console.log(`worker stopping (${signal})`);
  await worker.close();
  await runtime.dispose();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
