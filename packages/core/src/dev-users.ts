// Development-only account helpers, used by the seed script and the /__dev routes.
import { schema, type Db } from "@lifestory/db";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";

import { ensureOwnFamily, insertUser } from "./accounts.ts";
import { Database } from "./database.ts";

/** Password for every seeded and dev-created account. Development only. */
export const DEV_PASSWORD = "lifestory-dev-password";

/** Creates a user with the dev password if no user has this email. Returns the user's ID. */
export const ensureDevUser = async (
  db: Db,
  user: { id?: string; name: string; email: string; role?: string },
): Promise<string> => {
  const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, user.email));
  if (existing[0]) return existing[0].id;
  return insertUser(db, { ...user, password: DEV_PASSWORD });
};

/**
 * The /__dev/log-me-in account: finds or creates the user, and gives them a
 * one-person family if they're in none (D3), like any other new account.
 */
export const ensureDevAccount = Effect.fn("devUsers.ensureAccount")(function* (email: string) {
  const { db } = yield* Database;
  const userId = yield* Effect.promise(() => ensureDevUser(db, { name: email.split("@")[0] ?? email, email }));
  yield* ensureOwnFamily(userId);
});

/** Every local user, by email, for the /__dev index. */
export const listDevUsers = (db: Db) =>
  db
    .select({ name: schema.user.name, email: schema.user.email, role: schema.user.role })
    .from(schema.user)
    .orderBy(asc(schema.user.email));
