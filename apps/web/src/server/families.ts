// Families: the active family with its members, renaming it, inviting members and new families,
// and the family switcher. Role checks happen in @lifestory/core and Better Auth.
import {
  AccountExists,
  AuthRejected,
  FamilyName,
  FamilyMembership,
  FamilyOverview,
  Forbidden,
  InviteRole,
  NotAuthenticated,
  ResultSchema,
} from "@lifestory/core/contracts";
import { activeFamily, Auth, inviteFamily, inviteMember, renameFamily, switchFamily } from "@lifestory/core";
import { createServerFn } from "@tanstack/react-start";
import { appendResponseHeader, getRequest } from "@tanstack/react-start/server";
import { Effect, Schema } from "effect";
import { runEffect } from "./runtime.ts";

const currentUser = Auth.use((auth) => auth.requireUser(getRequest().headers));
const Email = Schema.String.check(Schema.isPattern(/^[^\s@]+@[^\s@]+$/));

export const FamiliesResult = ResultSchema(
  Schema.Struct({
    isOperator: Schema.Boolean,
    families: Schema.Array(FamilyMembership),
    active: Schema.NullOr(FamilyOverview),
  }),
  NotAuthenticated,
);

export const getFamilies = createServerFn({ method: "GET" }).handler(() =>
  runEffect(
    FamiliesResult,
    Effect.gen(function* () {
      const user = yield* currentUser;
      const { families, active } = yield* activeFamily(user);
      return { isOperator: user.role === "admin", families, active };
    }),
  ),
);

export const InviteMemberResult = ResultSchema(
  Schema.Struct({ id: Schema.String, email: Schema.String }),
  Schema.Union([NotAuthenticated, AuthRejected]),
);

export const inviteMemberFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ familyId: Schema.String, email: Email, role: InviteRole })))
  .handler(({ data }) =>
    runEffect(InviteMemberResult, currentUser.pipe(Effect.andThen(inviteMember(getRequest().headers, data)))),
  );

export const InviteFamilyResult = ResultSchema(
  Schema.Struct({ email: Schema.String }),
  Schema.Union([NotAuthenticated, Forbidden, AccountExists]),
);

export const inviteFamilyFn = createServerFn({ method: "POST" })
  .validator(
    Schema.toStandardSchemaV1(Schema.Struct({ name: Schema.String.check(Schema.isMinLength(1)), email: Email })),
  )
  .handler(({ data }) =>
    runEffect(
      InviteFamilyResult,
      Effect.gen(function* () {
        const user = yield* currentUser;
        return yield* inviteFamily(user, data);
      }),
    ),
  );

export const RenameFamilyResult = ResultSchema(
  Schema.Struct({ id: Schema.String, name: Schema.String }),
  Schema.Union([NotAuthenticated, AuthRejected]),
);

export const renameFamilyFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ familyId: Schema.String, name: FamilyName })))
  .handler(({ data }) =>
    runEffect(RenameFamilyResult, currentUser.pipe(Effect.andThen(renameFamily(getRequest().headers, data)))),
  );

export const SwitchFamilyResult = ResultSchema(
  Schema.Struct({ ok: Schema.Boolean }),
  Schema.Union([NotAuthenticated, AuthRejected]),
);

export const switchFamilyFn = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ familyId: Schema.String })))
  .handler(({ data }) =>
    runEffect(
      SwitchFamilyResult,
      Effect.gen(function* () {
        yield* currentUser;
        const cookies = yield* switchFamily(getRequest().headers, data.familyId);
        if (cookies.length > 0) appendResponseHeader("set-cookie", cookies);
        return { ok: true };
      }),
    ),
  );
