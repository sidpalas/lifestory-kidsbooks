// Family settings: the family's name, members, and invitations.
import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellPage } from "~/components/app-shell";
import { FamilyPanel } from "~/components/family-panel";
import { FamiliesResult, getFamilies } from "~/server/families";

export const Route = createFileRoute("/_family/family")({
  loader: async () => {
    try {
      return unwrapResult(FamiliesResult)(await getFamilies());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function Family() {
    const { active } = Route.useLoaderData();
    return (
      <ShellPage title={active?.role === "viewer" ? "Family" : "Family settings"}>
        {active ? <FamilyPanel family={active} /> : <p className="text-muted-foreground text-sm">You're not in a family yet.</p>}
      </ShellPage>
    );
  },
});
