// Development-only account helpers, used by the seed script and the dev sign-in route.
import { schema, type Db } from "@lifestory/db";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";

/** Password for every seeded and dev-created account. Development only. */
export const DEV_PASSWORD = "lifestory-dev-password";

/** Creates a user with the dev password if no user has this email. Returns the user's ID. */
export const ensureDevUser = async (
  db: Db,
  user: { id?: string; name: string; email: string; role?: string },
): Promise<string> => {
  const existing = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, user.email));
  if (existing[0]) return existing[0].id;
  const id = user.id ?? `user_${crypto.randomUUID()}`;
  await db
    .insert(schema.user)
    .values({ id, name: user.name, email: user.email, emailVerified: true, role: user.role ?? "user" })
    .onConflictDoNothing();
  await db
    .insert(schema.account)
    .values({ id: `account_${id}`, accountId: id, providerId: "credential", userId: id, password: await hashPassword(DEV_PASSWORD) })
    .onConflictDoNothing();
  return id;
};
