import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellPage } from "~/components/app-shell";
import { FamilyCharacters } from "~/components/family-library";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/_family/characters/")({
  loader: async () => {
    try {
      return unwrapResult(FamilyLibraryResult)(await getFamilyLibrary());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function Characters() {
    const { characters, canEdit } = Route.useLoaderData();
    return (
      <ShellPage
        title="Characters"
        description="Your family as drawn in books. Each story draws these looks with its own illustrations."
      >
        <FamilyCharacters characters={characters} canEdit={canEdit} />
      </ShellPage>
    );
  },
});
