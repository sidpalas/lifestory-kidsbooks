import { schema } from "@lifestory/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements as adminDefaultStatements } from "better-auth/plugins/admin/access";
import { defaultStatements as orgDefaultStatements } from "better-auth/plugins/organization/access";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Config, Context, Effect, Layer, Redacted } from "effect";
import { APIError } from "better-auth/api";
import { FAMILY_NAME_MAX_LENGTH, MIN_PASSWORD_LENGTH } from "./contracts.ts";
import { Database } from "./database.ts";
import { NotAuthenticated } from "./errors.ts";
import { Mailer } from "./mailer.ts";

/** How long invitations and set-password links stay valid: a week, so a grandparent can open it later. */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** How long the worker's print page link works: long enough to render a book, useless once leaked into a log. */
const PRINT_TOKEN_TTL_MS = 10 * 60 * 1000;

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
  sendInvitationEmail: (invite: {
    id: string;
    email: string;
    familyName: string;
    inviterName: string;
    role: string;
  }) => Promise<void>;
}) =>
  betterAuth({
    appName: "Lifestory",
    secret: options.secret,
    baseURL: options.baseURL,
    // Extra origins allowed to call the auth API besides baseURL, e.g. http://localhost:3000
    // next to an Amp portal origin in development.
    trustedOrigins: [...options.trustedOrigins],
    database: drizzleAdapter(options.db, { provider: "pg", schema }),
    // Invite-only: nobody can sign up on their own. Accounts come from invitations
    // (accounts.ts), the operator command, or the development seed (D3).
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: MIN_PASSWORD_LENGTH },
    plugins: [
      organization({
        ac: familyAccess,
        roles: familyRoles,
        creatorRole: "owner",
        // No family deletion until account deletion is designed (D31): it would leave the owner without a family (D3).
        disableOrganizationDeletion: true,
        invitationExpiresIn: INVITE_TTL_SECONDS,
        // Better Auth checks `organization: update` (owners only). Its update endpoint also takes a slug, logo, and
        // metadata from any caller; families only ever change their name, trimmed and within FAMILY_NAME_MAX_LENGTH.
        organizationHooks: {
          beforeUpdateOrganization: async ({ organization: data }) => {
            const name = typeof data.name === "string" ? data.name.trim() : "";
            if (
              Object.keys(data).some((key) => key !== "name") ||
              name.length === 0 ||
              name.length > FAMILY_NAME_MAX_LENGTH
            ) {
              throw new APIError("BAD_REQUEST", {
                message: `A family name needs 1 to ${FAMILY_NAME_MAX_LENGTH} characters, and only the name can change.`,
              });
            }
            return { data: { name } };
          },
        },
        sendInvitationEmail: (data) =>
          options.sendInvitationEmail({
            id: data.id,
            email: data.email,
            familyName: data.organization.name,
            inviterName: data.inviter.user.name,
            role: data.role,
          }),
      }),
      admin({ ac: operatorAccess, roles: operatorRoles, defaultRole: "user", adminRoles: ["admin"] }),
    ],
  });

export type AuthInstance = ReturnType<typeof makeAuth>;

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Admin plugin role: "admin" is the operator. */
  readonly role: string;
  /** The session's active family, if one was chosen (see families.ts activeFamily). */
  readonly activeFamilyId: string | null;
}

export class Auth extends Context.Service<
  Auth,
  {
    readonly auth: AuthInstance;
    /** An absolute URL to a path of the app, for links in emails. */
    readonly appUrl: (path: string) => string;
    /** Resolves the signed-in user from request headers, or fails with NotAuthenticated. */
    readonly requireUser: (headers: Headers) => Effect.Effect<SessionUser, NotAuthenticated>;
    /**
     * A short-lived token that lets the worker's headless Chromium open one proof's print page without a session
     * (D27). Signed with BETTER_AUTH_SECRET, which both processes have.
     */
    readonly printToken: {
      readonly sign: (proofId: string) => string;
      readonly verify: (proofId: string, token: string) => boolean;
    };
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
      const mailer = yield* Mailer;
      // new URL, not concatenation: a public URL with a trailing slash would make "//path" links.
      const appUrl = (path: string) => new URL(path, baseURL).href;
      const auth = makeAuth({
        db,
        secret: Redacted.value(secret),
        baseURL,
        trustedOrigins,
        sendInvitationEmail: (invite) =>
          Effect.runPromise(
            mailer.send({
              to: invite.email,
              subject: `${invite.inviterName} invited you to ${invite.familyName} on Lifestory`,
              text: `${invite.inviterName} invited you to join ${invite.familyName} as ${invite.role === "viewer" ? "a viewer (you can read the family's books)" : "a parent (you can edit the family's books)"}. Open the link to accept:`,
              link: appUrl(`/invitations/${invite.id}`),
            }),
          ),
      });
      // Domain-separated from Better Auth's own use of the secret.
      const printSignature = (proofId: string, expires: number) =>
        createHmac("sha256", Redacted.value(secret))
          .update(`lifestory.print-proof:${proofId}:${expires}`)
          .digest("base64url");
      return {
        auth,
        appUrl,
        printToken: {
          sign: (proofId) => {
            const expires = Date.now() + PRINT_TOKEN_TTL_MS;
            return `${expires}.${printSignature(proofId, expires)}`;
          },
          verify: (proofId, token) => {
            const [expires, signature] = token.split(".");
            if (!expires || !signature || !(Number(expires) > Date.now())) return false;
            const expected = Buffer.from(printSignature(proofId, Number(expires)));
            const given = Buffer.from(signature);
            return given.length === expected.length && timingSafeEqual(given, expected);
          },
        },
        requireUser: (headers) =>
          Effect.promise(() => auth.api.getSession({ headers })).pipe(
            Effect.flatMap((session) =>
              session
                ? Effect.succeed({
                    id: session.user.id,
                    name: session.user.name,
                    email: session.user.email,
                    role: session.user.role ?? "user",
                    activeFamilyId: session.session.activeOrganizationId ?? null,
                  })
                : Effect.fail(new NotAuthenticated()),
            ),
          ),
      };
    }),
  );
}
