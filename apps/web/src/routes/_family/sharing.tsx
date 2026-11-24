// Sharing: the family's name, who can open its books (members and invitations), and inviting someone.
import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ShellPage } from "~/components/app-shell";
import { FamilyPanel } from "~/components/family-panel";
import { FamiliesResult, getFamilies } from "~/server/families";

export const Route = createFileRoute("/_family/sharing")({
  loader: async () => {
    try {
      return unwrapResult(FamiliesResult)(await getFamilies());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function Sharing() {
    const { active } = Route.useLoaderData();
    return (
      <ShellPage
        title="Sharing"
        description={
          active
            ? `Who can open ${active.name}'s books. Being here doesn't put anyone in a book; you say who plays each part when you make one.`
            : undefined
        }
      >
        {active ? (
          <div className="w-full max-w-2xl">
            <FamilyPanel family={active} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">You're not in a family yet.</p>
        )}
      </ShellPage>
    );
  },
});
