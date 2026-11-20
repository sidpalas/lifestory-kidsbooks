// The family pages inside the app shell (D48). Home ("/") renders the same shell itself, because signed-out
// visitors get the landing page there instead.
import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { AppShell } from "~/components/app-shell";
import { getHome, HomeResult } from "~/server/functions";

export const Route = createFileRoute("/_family")({
  loader: async () => {
    try {
      return unwrapResult(HomeResult)(await getHome());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: () => (
    <AppShell shell={Route.useLoaderData()}>
      <Outlet />
    </AppShell>
  ),
});
