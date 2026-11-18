import { schema } from "@lifestory/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as orgDefaultStatements } from "better-auth/plugins/organization/access";
import { Config, Context, Effect, Layer, Redacted } from "effect";
import { Database } from "./database.ts";
import { NotAuthenticated } from "./errors.ts";

// ---- Family (organization) roles --------------------------------------------
// A family is a Better Auth organization. "owner" and "parent" can edit books;
// "viewer" (for example a grandparent) can only read them.
const familyStatements = { ...orgDefaultStatements, book: ["read", "edit"] } as const;
export const familyAccess = createAccessControl(familyStatements);
export const familyRoles = {
  owner: familyAccess.newRole({
    organization: ["update", "delete"],
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
    book: ["read", "edit"],
  }),
  parent: familyAccess.newRole({
    member: ["create", "update"],
    invitation: ["create", "cancel"],
    book: ["read", "edit"],
  }),
  viewer: familyAccess.newRole({ book: ["read"] }),
};
export type FamilyRole = keyof typeof familyRoles;

// ---- Operator (admin plugin) roles ------------------------------------------
// The operator role deliberately has no "impersonate" permissions: accounts hold
// photos of children, so nobody can sign in as another user.
const operatorAccess = createAccessControl(adminDefaultStatements);
const operatorRoles = {
  admin: operatorAccess.newRole({
    user: ["create", "list", "set-role", "ban", "delete", "set-password", "get", "update"],
    session: ["list", "revoke", "delete"],
  }),
  user: operatorAccess.newRole({ user: [], session: [] }),
};

const makeAuth = (options: {
  db: Database["Service"]["db"];
  secret: string;
  baseURL: string;
  trustedOrigins: ReadonlyArray<string>;
}) =>
  betterAuth({
    appName: "Lifestory",
    secret: options.secret,
    baseURL: options.baseURL,
    // Extra origins allowed to call the auth API besides baseURL, e.g. http://localhost:3000
    // next to an Amp portal origin in development.
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, { provider: "pg", schema }),
    // Invite-only: nobody can sign up on their own. Accounts are created from
    // invitations (milestone 1) or by the seed script.
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    plugins: [
      organization({ ac: familyAccess, roles: familyRoles, creatorRole: "owner" }),
      admin({ ac: operatorAccess, roles: operatorRoles, defaultRole: "user", adminRoles: ["admin"] }),
    ],
  });

export type AuthInstance = ReturnType<typeof makeAuth>;

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export class Auth extends Context.Service<
  Auth,
  {
    readonly auth: AuthInstance;
    /** Resolves the signed-in user from request headers, or fails with NotAuthenticated. */
    readonly requireUser: (headers: Headers) => Effect.Effect<SessionUser, NotAuthenticated>;
  }
>()("@lifestory/core/Auth") {
  static readonly layer = Layer.effect(
    Auth,
    Effect.gen(function* () {
      const { db } = yield* Database;
      const secret = yield* Config.Redacted("BETTER_AUTH_SECRET");
      const baseURL = yield* Config.String("BETTER_AUTH_URL").pipe(Config.withDefault("http://localhost:3000"));
      const trustedOrigins = (yield* Config.String("BETTER_AUTH_TRUSTED_ORIGINS").pipe(Config.withDefault("")))
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
      const auth = makeAuth({ db, secret: Redacted.value(secret), baseURL, trustedOrigins });
      return {
        auth,
        requireUser: (headers) =>
          Effect.promise(() => auth.api.getSession({ headers })).pipe(
            Effect.flatMap((session) =>
              session
                ? Effect.succeed({ id: session.user.id, name: session.user.name, email: session.user.email })
                : Effect.fail(new NotAuthenticated()),
            ),
          ),
      };
    }),
  );
}
