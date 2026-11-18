import { createDb, type Db } from "@lifestory/db";
import { sql } from "drizzle-orm";
import { Context, Effect, Layer, Redacted } from "effect";
import { Pool } from "pg";
import { AppConfig } from "./config.ts";

/** One pg pool per process, shared by Drizzle, Better Auth, and Absurd. */
export class Database extends Context.Service<Database, { readonly pool: Pool; readonly db: Db }>()(
  "@lifestory/core/Database",
) {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const pool = yield* Effect.acquireRelease(
        Effect.sync(() => new Pool({ connectionString: Redacted.value(config.databaseUrl), max: 10 })),
        (p) => Effect.promise(() => p.end()),
      );
      return { pool, db: createDb(pool) };
    }),
  );

  /** Runs a Drizzle query. Database failures are defects: callers can't recover from them. */
  static query<A>(f: (db: Db) => Promise<A>): Effect.Effect<A, never, Database> {
    return Database.use(({ db }) => Effect.promise(() => f(db)));
  }
}

/** Number of applied migrations: the readiness check's proof that Postgres answers and is migrated. */
export const countAppliedMigrations = Database.query((db) =>
  db.execute<{ count: number }>(sql`select count(*)::int as count from drizzle.__drizzle_migrations`),
).pipe(Effect.map(({ rows }) => rows[0]?.count ?? 0));
