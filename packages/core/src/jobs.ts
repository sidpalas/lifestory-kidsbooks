import { Absurd, type TaskContext } from "absurd-sdk";
import { Context, Effect, Layer, Schema } from "effect";
import { Database } from "./database.ts";
import type { TaskState } from "./contracts.ts";
import { JobError } from "./errors.ts";

/**
 * A durable task: an Effect program that Absurd runs on the worker.
 *
 * Absurd may run a task more than once (retries, crashes, suspensions), so the
 * program must only do side effects inside `step`, and every step must be
 * idempotent: derive keys from `ctx.taskID` and write with upserts or
 * deterministic object keys.
 */
export interface TaskDefinition<P extends Schema.Top, A, E, R> {
  readonly name: string;
  readonly params: P;
  readonly run: (params: P["Type"], ctx: TaskContext) => Effect.Effect<A, E, R>;
}

export const defineTask = <P extends Schema.Top, A, E, R>(definition: TaskDefinition<P, A, E, R>) => definition;

/**
 * Runs `effect` as a checkpointed Absurd step. Once the step succeeds its JSON
 * result is stored and later runs of the task return it without running the
 * effect again. A failure fails the run, and Absurd retries the task.
 */
export const step = <A, E, R>(ctx: TaskContext, name: string, effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    return yield* Effect.promise(() => ctx.step(name, () => Effect.runPromiseWith(context)(effect)));
  });

const fail = (cause: unknown) => new JobError({ message: cause instanceof Error ? cause.message : String(cause) });

export class Jobs extends Context.Service<
  Jobs,
  {
    readonly client: Absurd;
    readonly spawn: <P extends Schema.Codec<any, any, never, never>>(
      task: { readonly name: string; readonly params: P },
      params: P["Type"],
      options?: { readonly idempotencyKey?: string },
    ) => Effect.Effect<{ readonly taskId: string }, JobError>;
    readonly status: (taskId: string) => Effect.Effect<{
      readonly state: TaskState;
      readonly result: unknown;
    }, JobError>;
  }
>()("@lifestory/core/Jobs") {
  static readonly queue = "default";

  static readonly layer = Layer.effect(
    Jobs,
    Effect.gen(function* () {
      const { pool } = yield* Database;
      // The Absurd client borrows the shared pool; closing it does not end the pool.
      const client = new Absurd({ db: pool, queueName: Jobs.queue });
      return {
        client,
        spawn: (task, params, options) =>
          Effect.gen(function* () {
            const encoded = yield* Schema.encodeUnknownEffect(task.params)(params).pipe(Effect.mapError(fail));
            const spawned = yield* Effect.tryPromise({
              try: () =>
                client.spawn(task.name, encoded, {
                  queue: Jobs.queue,
                  ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
                }),
              catch: fail,
            });
            return { taskId: spawned.taskID };
          }),
        status: (taskId) =>
          Effect.tryPromise({ try: () => client.fetchTaskResult(taskId, { queue: Jobs.queue }), catch: fail }).pipe(
            Effect.flatMap((snapshot) =>
              snapshot
                ? Effect.succeed({ state: snapshot.state, result: "result" in snapshot ? snapshot.result : null })
                : Effect.fail(new JobError({ message: `unknown task ${taskId}` })),
            ),
          ),
      };
    }),
  );
}
