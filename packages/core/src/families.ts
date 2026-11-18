import { schema } from "@lifestory/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { Effect } from "effect";
import { authCall } from "./accounts.ts";
import { familyRoles, type FamilyRole, type SessionUser } from "./auth.ts";
import type { FamilyMembership, FamilyOverview, InvitationDetails, InviteRole } from "./contracts.ts";
import { Database } from "./database.ts";
import { InviteInvalid, NotFound } from "./errors.ts";

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

const can = (role: string, permissions: Parameters<(typeof familyRoles)["owner"]["authorize"]>[0]) =>
  role in familyRoles && familyRoles[role as FamilyRole].authorize(permissions).success;

/**
 * The family pages show: the session's active family if the user is still in it,
 * otherwise their first family. With its members, pending invitations, and what the
 * user's role allows. Null only for a user in no family (which D3 rules out).
 */
export const activeFamily = Effect.fn("families.active")(function* (user: SessionUser) {
  const families = yield* listUserFamilies(user.id);
  const current = families.find((family) => family.id === user.activeFamilyId) ?? families[0];
  if (!current) return { families, active: null };
  const [members, invitations] = yield* Effect.all([
    Database.query((db) =>
      db
        .select({ userId: schema.user.id, name: schema.user.name, email: schema.user.email, role: schema.member.role })
        .from(schema.member)
        .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
        .where(eq(schema.member.organizationId, current.id))
        .orderBy(asc(schema.member.createdAt)),
    ),
    Database.query((db) =>
      db
        .select({ id: schema.invitation.id, email: schema.invitation.email, role: schema.invitation.role })
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, current.id),
            eq(schema.invitation.status, "pending"),
            gt(schema.invitation.expiresAt, new Date()),
          ),
        )
        .orderBy(asc(schema.invitation.createdAt)),
    ),
  ]);
  const active: FamilyOverview = {
    ...current,
    canInvite: can(current.role, { invitation: ["create"] }),
    canEditBooks: can(current.role, { book: ["edit"] }),
    members,
    invitations: invitations.map((invitation) => ({ ...invitation, role: invitation.role ?? "viewer" })),
  };
  return { families, active };
});

/** Invites someone into a family. Better Auth checks the inviter's role and emails the link. */
export const inviteMember = Effect.fn("families.inviteMember")(function* (
  headers: Headers,
  input: { familyId: string; email: string; role: InviteRole },
) {
  const invitation = yield* authCall((auth) =>
    auth.api.createInvitation({ headers, body: { organizationId: input.familyId, email: input.email, role: input.role } }),
  );
  return { id: invitation.id, email: invitation.email };
});

/** Makes another of the user's families the active one. Returns Set-Cookie headers. */
export const switchFamily = Effect.fn("families.switch")(function* (headers: Headers, familyId: string) {
  const { headers: responseHeaders } = yield* authCall((auth) =>
    auth.api.setActiveOrganization({ headers, body: { organizationId: familyId }, returnHeaders: true }),
  );
  return responseHeaders.getSetCookie();
});

/**
 * What the invitation page shows. Anyone holding the link may see it: the ID is the
 * secret that was emailed. Fails with InviteInvalid once it's used, expired, or canceled.
 */
export const invitationDetails = Effect.fn("families.invitationDetails")(function* (invitationId: string) {
  const [row] = yield* Database.query((db) =>
    db
      .select({
        email: schema.invitation.email,
        role: schema.invitation.role,
        status: schema.invitation.status,
        expiresAt: schema.invitation.expiresAt,
        familyName: schema.organization.name,
        inviterName: schema.user.name,
      })
      .from(schema.invitation)
      .innerJoin(schema.organization, eq(schema.organization.id, schema.invitation.organizationId))
      .innerJoin(schema.user, eq(schema.user.id, schema.invitation.inviterId))
      .where(eq(schema.invitation.id, invitationId)),
  );
  if (!row) return yield* new NotFound({ entity: "invitation", id: invitationId });
  if (row.status !== "pending" || row.expiresAt < new Date()) return yield* new InviteInvalid();
  const [account] = yield* Database.query((db) =>
    db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, row.email)),
  );
  return {
    email: row.email,
    role: row.role ?? "viewer",
    familyName: row.familyName,
    inviterName: row.inviterName,
    hasAccount: account !== undefined,
  } satisfies InvitationDetails;
});
