// Sign-in, set-password links, and accepting invitations. The domain logic is in
// @lifestory/core/accounts; these adapt requests to it and pass session cookies on.
import {
  AccountExists,
  AuthRejected,
  InvalidCredentials,
  InvitationDetails,
  InviteInvalid,
  MIN_PASSWORD_LENGTH,
  NotAuthenticated,
  NotFound,
  ResultSchema,
} from "@lifestory/core/contracts";
import {
  acceptInvitation,
  acceptInvitationAsNewUser,
  Auth,
  findPasswordToken,
  invitationDetails,
  setPasswordFromLink,
  signIn,
} from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

const Password = Schema.String.check(Schema.isMinLength(MIN_PASSWORD_LENGTH));
const Done = Schema.Struct({ ok: Schema.Boolean });

/** Passes a new session's cookies to the browser. */
const setCookies = (cookies: ReadonlyArray<string>) =>
  Effect.sync(() => {
    if (cookies.length > 0) appendResponseHeader("set-cookie", [...cookies]);
    return { ok: true };
  });

export const SignInResult = ResultSchema(Done, InvalidCredentials);

export const signInWithPassword = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ email: Schema.String, password: Schema.String })))
  .handler(({ data }) => runEffect(SignInResult, signIn(data).pipe(Effect.flatMap(setCookies))));

export const SignOutResult = ResultSchema(Done, Schema.Never);

export const signOut = createServerFn({ method: "POST" }).handler(() =>
  runEffect(
    SignOutResult,
    Auth.use(({ auth }) =>
      Effect.promise(() => auth.api.signOut({ headers: getRequest().headers, returnHeaders: true })),
    ).pipe(Effect.flatMap(({ headers }) => setCookies(headers.getSetCookie()))),
  ),
);

export const PasswordLinkResult = ResultSchema(
  Schema.Struct({ name: Schema.String, email: Schema.String }),
  InviteInvalid,
);

export const getPasswordLink = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ token: Schema.String })))
  .handler(({ data }) => runEffect(PasswordLinkResult, findPasswordToken(data.token)));

export const SetPasswordResult = ResultSchema(Done, InviteInvalid);

export const setPassword = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ token: Schema.String, password: Password })))
  .handler(({ data }) => runEffect(SetPasswordResult, setPasswordFromLink(data).pipe(Effect.flatMap(setCookies))));

export const InvitationResult = ResultSchema(
  Schema.Struct({ invitation: InvitationDetails, signedInEmail: Schema.NullOr(Schema.String) }),
  Schema.Union([NotFound, InviteInvalid]),
);

export const getInvitation = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ invitationId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      InvitationResult,
      Effect.gen(function* () {
        const invitation = yield* invitationDetails(data.invitationId);
        const user = yield* Auth.use((auth) => auth.requireUser(getRequest().headers)).pipe(Effect.option);
        return { invitation, signedInEmail: user._tag === "Some" ? user.value.email : null };
      }),
    ),
  );

export const AcceptInvitationResult = ResultSchema(
  Done,
  Schema.Union([InviteInvalid, AccountExists, AuthRejected, NotAuthenticated]),
);

/** Accepts as a new account (name and password given) or as the signed-in user. */
export const acceptInvitationFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        invitationId: Schema.String,
        newAccount: Schema.optional(
          Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), password: Password }),
        ),
      }),
    ),
  )
  .handler(({ data }) =>
    runEffect(
      AcceptInvitationResult,
      Effect.gen(function* () {
        const headers = getRequest().headers;
        if (data.newAccount)
          return yield* acceptInvitationAsNewUser({ invitationId: data.invitationId, ...data.newAccount });
        yield* Auth.use((auth) => auth.requireUser(headers));
        return yield* acceptInvitation(data.invitationId, headers);
      }).pipe(Effect.flatMap(setCookies)),
    ),
  );
