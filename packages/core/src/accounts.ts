// Accounts and their families. Every account belongs to a family (docs/decisions.md D3):
// one that isn't joining an existing family gets a one-person family, with its user as
// owner, when it is created. Every way of creating an account goes through this file:
// the operator's new-family invite, a member invitation, the operator command (D21),
// and the development sign-in route and seed.
import { schema, type Db } from "@lifestory/db";
import { isAPIError } from "better-auth/api";
import { generateRandomString, hashPassword } from "better-auth/crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { Effect } from "effect";
import { Auth, INVITE_TTL_SECONDS } from "./auth.ts";
import { Database } from "./database.ts";
import { AccountExists, AuthRejected, Forbidden, InvalidCredentials, InviteInvalid } from "./errors.ts";
import { Mailer } from "./mailer.ts";

/** Better Auth stores set-password tokens under this prefix; its /reset-password endpoint consumes them. */
const passwordTokenIdentifier = (token: string) => `reset-password:${token}`;

/** Inserts a user, and a password login when a password is given. Returns the new user's ID. */
export const insertUser = async (
  db: Db,
  user: { id?: string; name: string; email: string; role?: string; password?: string },
): Promise<string> => {
  const id = user.id ?? `user_${crypto.randomUUID()}`;
  await db.transaction(async (tx) => {
    await tx
      .insert(schema.user)
      .values({ id, name: user.name, email: user.email.toLowerCase(), emailVerified: true, role: user.role ?? "user" });
    if (user.password !== undefined)
      await tx.insert(schema.account).values({
        id: `account_${id}`,
        accountId: id,
        providerId: "credential",
        userId: id,
        password: await hashPassword(user.password),
      });
  });
  return id;
};

const findUserByEmail = (email: string) =>
  Database.query(async (db) => {
    const [user] = await db
      .select({ id: schema.user.id, name: schema.user.name, role: schema.user.role })
      .from(schema.user)
      .where(eq(schema.user.email, email.toLowerCase()));
    if (!user) return undefined;
    const [login] = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(
        and(
          eq(schema.account.userId, user.id),
          eq(schema.account.providerId, "credential"),
          isNotNull(schema.account.password),
        ),
      );
    return { ...user, hasPassword: login !== undefined };
  });

/** Runs a Better Auth API call; its refusals become AuthRejected, anything else is a defect. */
export const authCall = <A>(call: (auth: Auth["Service"]["auth"]) => Promise<A>) =>
  Auth.use(({ auth }) =>
    Effect.tryPromise({
      try: () => call(auth),
      catch: (error) => (isAPIError(error) ? error : { defect: error }),
    }),
  ).pipe(
    Effect.catch((error) =>
      "defect" in error
        ? Effect.die(error.defect)
        : Effect.fail(
            new AuthRejected({
              code: String(error.body?.code ?? error.status),
              message: error.body?.message ?? error.message,
            }),
          ),
    ),
  );

const familySlug = (name: string) =>
  `${
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "family"
  }-${generateRandomString(6, "a-z", "0-9")}`;

/**
 * Gives a user their one-person family, "<name>'s family", unless they already belong
 * to a family. Idempotent. Uses Better Auth's createOrganization as a system action
 * (userId and no session), so the user becomes its owner. Returns the user's first family.
 */
export const ensureOwnFamily = Effect.fn("accounts.ensureOwnFamily")(function* (userId: string) {
  const existing = yield* Database.query((db) =>
    db
      .select({ id: schema.member.organizationId })
      .from(schema.member)
      .where(eq(schema.member.userId, userId))
      .limit(1),
  );
  if (existing[0]) return existing[0].id;
  const [user] = yield* Database.query((db) =>
    db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)),
  );
  if (!user) return yield* Effect.die(new Error(`no user ${userId}`));
  const name = `${user.name}'s family`;
  const family = yield* authCall((auth) =>
    auth.api.createOrganization({ body: { name, slug: familySlug(user.name), userId } }),
  ).pipe(Effect.orDie);
  return family.id;
});

/** Creates an account with its one-person family. Fails if the email is taken. */
export const createAccountWithFamily = Effect.fn("accounts.createWithFamily")(function* (input: {
  name: string;
  email: string;
  role?: "user" | "admin";
  password?: string;
}) {
  if (yield* findUserByEmail(input.email)) return yield* new AccountExists({ email: input.email.toLowerCase() });
  const userId = yield* Database.query((db) => insertUser(db, input));
  const familyId = yield* ensureOwnFamily(userId);
  return { userId, familyId };
});

/**
 * The operator invites a new family: creates the account (without a password) and its
 * family now, and emails a link where the invitee sets their password (D23). Inviting an
 * email again before its owner set a password sends a fresh link; once they have, it fails.
 */
export const inviteFamily = Effect.fn("accounts.inviteFamily")(function* (
  operator: { role: string },
  input: { name: string; email: string },
) {
  if (operator.role !== "admin") return yield* new Forbidden({ message: "Only the operator can invite a new family." });
  const existing = yield* findUserByEmail(input.email);
  if (existing?.hasPassword) return yield* new AccountExists({ email: input.email.toLowerCase() });
  const userId = existing?.id ?? (yield* createAccountWithFamily(input)).userId;
  yield* ensureOwnFamily(userId);

  const token = generateRandomString(32, "a-z", "A-Z", "0-9");
  const { auth, appUrl } = yield* Auth;
  yield* Effect.promise(async () =>
    (await auth.$context).internalAdapter.createVerificationValue({
      identifier: passwordTokenIdentifier(token),
      value: userId,
      expiresAt: new Date(Date.now() + INVITE_TTL_SECONDS * 1000),
    }),
  );
  const name = existing?.name ?? input.name;
  yield* Mailer.use((mailer) =>
    mailer.send({
      to: input.email.toLowerCase(),
      subject: "You're invited to Lifestory",
      text: `Hi ${name}, your family's Lifestory account is ready. Choose a password to sign in:`,
      link: appUrl(`/set-password/${token}`),
    }),
  );
  return { email: input.email.toLowerCase() };
});

/** Who a set-password link belongs to, or InviteInvalid if it's unknown, used, or expired. */
export const findPasswordToken = Effect.fn("accounts.findPasswordToken")(function* (token: string) {
  const { auth } = yield* Auth;
  const verification = yield* Effect.promise(async () =>
    (await auth.$context).internalAdapter.findVerificationValue(passwordTokenIdentifier(token)),
  );
  if (!verification || verification.expiresAt < new Date()) return yield* new InviteInvalid();
  const [user] = yield* Database.query((db) =>
    db
      .select({ name: schema.user.name, email: schema.user.email })
      .from(schema.user)
      .where(eq(schema.user.id, verification.value)),
  );
  if (!user) return yield* new InviteInvalid();
  return user;
});

/** Signs in with email and password. Returns the Set-Cookie headers of the new session. */
export const signIn = Effect.fn("accounts.signIn")(function* (input: { email: string; password: string }) {
  const { headers } = yield* authCall((auth) =>
    auth.api.signInEmail({ body: { email: input.email, password: input.password }, returnHeaders: true }),
  ).pipe(Effect.catchTag("AuthRejected", () => Effect.fail(new InvalidCredentials())));
  return headers.getSetCookie();
});

/** Sets the first password from a set-password link, then signs in. Returns the session's Set-Cookie headers. */
export const setPasswordFromLink = Effect.fn("accounts.setPasswordFromLink")(function* (input: {
  token: string;
  password: string;
}) {
  const user = yield* findPasswordToken(input.token);
  yield* authCall((auth) => auth.api.resetPassword({ body: { token: input.token, newPassword: input.password } })).pipe(
    Effect.catchIf(
      (error) => error.code === "INVALID_TOKEN",
      () => Effect.fail(new InviteInvalid()),
    ),
  );
  return yield* signIn({ email: user.email, password: input.password }).pipe(Effect.orDie);
});

/** A pending, unexpired invitation into a family, or InviteInvalid. */
const pendingInvitation = (invitationId: string) =>
  Effect.gen(function* () {
    const [invitation] = yield* Database.query((db) =>
      db.select().from(schema.invitation).where(eq(schema.invitation.id, invitationId)),
    );
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt < new Date())
      return yield* new InviteInvalid();
    return invitation;
  });

/**
 * Accepts an invitation into a family as someone without an account: creates the
 * account with the chosen password (no family of its own: they're joining one), signs
 * in, and accepts through Better Auth, which adds the membership and makes that family
 * active. Opening the emailed link is what proves the email. Returns Set-Cookie headers.
 */
export const acceptInvitationAsNewUser = Effect.fn("accounts.acceptInvitationAsNewUser")(function* (input: {
  invitationId: string;
  name: string;
  password: string;
}) {
  const invitation = yield* pendingInvitation(input.invitationId);
  if (yield* findUserByEmail(invitation.email)) return yield* new AccountExists({ email: invitation.email });
  yield* Database.query((db) =>
    insertUser(db, { name: input.name, email: invitation.email, password: input.password }),
  );
  const signInCookies = yield* signIn({ email: invitation.email, password: input.password }).pipe(Effect.orDie);
  const accepted = yield* acceptInvitation(input.invitationId, cookieHeaders(signInCookies));
  return [...signInCookies, ...accepted];
});

/** Accepts an invitation as the signed-in user (in `headers`). Returns Set-Cookie headers. */
export const acceptInvitation = Effect.fn("accounts.acceptInvitation")(function* (
  invitationId: string,
  headers: Headers,
) {
  yield* pendingInvitation(invitationId);
  const { headers: responseHeaders } = yield* authCall((auth) =>
    auth.api.acceptInvitation({ body: { invitationId }, headers, returnHeaders: true }),
  );
  return responseHeaders.getSetCookie();
});

/** Request headers carrying the cookies from Set-Cookie headers, to call Better Auth as that session. */
const cookieHeaders = (setCookies: ReadonlyArray<string>) =>
  new Headers({ cookie: setCookies.map((cookie) => cookie.split(";")[0]).join("; ") });
