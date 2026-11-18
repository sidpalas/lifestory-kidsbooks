// Development-only sign-out: GET /__dev/log-me-out?returnTo=/path
// Ends the browser's Better Auth session, clears its cookie, and redirects to a same-origin path.
// Returns 404 unless DEV_LOGIN_ENABLED=true and NODE_ENV isn't production.
import { Auth } from "@lifestory/core";
import { createFileRoute } from "@tanstack/react-router";
import { Effect } from "effect";
import { devRouteNotFound, devRoutesEnabled } from "~/lib/dev-routes";
import { safeReturnTo } from "~/lib/safe-return-to";
import { serverRuntime } from "~/server/runtime";

export const Route = createFileRoute("/__dev/log-me-out")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!devRoutesEnabled()) return devRouteNotFound();
        const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
        const signOut = await serverRuntime().runPromise(
          Auth.use(({ auth }) => Effect.promise(() => auth.api.signOut({ headers: request.headers, asResponse: true }))),
        );
        const headers = new Headers({ location: returnTo });
        for (const cookie of signOut.headers.getSetCookie()) headers.append("set-cookie", cookie);
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
