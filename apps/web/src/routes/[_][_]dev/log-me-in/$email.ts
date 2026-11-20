// Development-only sign-in: GET /__dev/log-me-in/<email>?returnTo=/path
// Finds or creates the user (with a one-person family, like every new account),
// signs in with the dev password, sets Better
// Auth's normal session cookie, and redirects to a same-origin path.
// Returns 404 unless DEV_LOGIN_ENABLED=true and NODE_ENV isn't production.
import { Auth, ensureDevAccount, DEV_PASSWORD } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";

import { devRouteNotFound, devRoutesEnabled } from "~/lib/dev-routes";
import { safeReturnTo } from "~/lib/safe-return-to";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/__dev/log-me-in/$email")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!devRoutesEnabled()) return devRouteNotFound();
        const email = params.email.toLowerCase();
        const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
        const signIn = await serverRuntime().runPromise(
          Effect.gen(function* () {
            const { auth } = yield* Auth;
            yield* ensureDevAccount(email);
            return yield* Effect.promise(() =>
              auth.api.signInEmail({
                body: { email, password: DEV_PASSWORD },
                headers: request.headers,
                asResponse: true,
              }),
            );
          }),
        );
        if (!signIn.ok) return new Response(`Dev sign-in failed: ${await signIn.text()}`, { status: 500 });
        const headers = new Headers({ location: returnTo });
        for (const cookie of signIn.headers.getSetCookie()) headers.append("set-cookie", cookie);
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
