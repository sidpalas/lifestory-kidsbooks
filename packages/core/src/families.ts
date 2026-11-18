import { schema } from "@lifestory/db";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { FamilyMembership } from "./contracts.ts";
import { Database } from "./database.ts";

/** The families a user belongs to, with their role in each, by family name. */
export const listUserFamilies = Effect.fn("families.listForUser")(function* (userId: string) {
  const rows = yield* Database.query((db) =>
    db
      .select({ id: schema.organization.id, name: schema.organization.name, role: schema.member.role })
      .from(schema.member)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
      .where(eq(schema.member.userId, userId))
      .orderBy(asc(schema.organization.name)),
  );
  return rows satisfies ReadonlyArray<FamilyMembership>;
});
