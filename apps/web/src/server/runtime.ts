// The web server's one ManagedRuntime. Cached on globalThis so Vite's hot
// reload doesn't open a new pg pool on every edit.
import { makeServerRuntime, type ServerRuntime, type ServerServices } from "@lifestory/core";
import { Effect, type Exit, Schema } from "effect";

const cache = globalThis as { __lifestoryRuntime?: ServerRuntime };
export const serverRuntime = (): ServerRuntime => (cache.__lifestoryRuntime ??= makeServerRuntime());

/**
 * Runs a server function's Effect and encodes its Exit with the endpoint's
 * result schema (see @lifestory/core/contracts ResultSchema). Failures to build
 * the runtime itself (bad config, database down) reject and become a 500.
 */
export const runEffect = async <A, E>(
  schema: Schema.Codec<Exit.Exit<A, E>, Schema.Json>,
  effect: Effect.Effect<A, E, ServerServices>,
): Promise<Schema.Json> => Schema.encodeSync(schema)(await serverRuntime().runPromise(Effect.exit(effect)));
