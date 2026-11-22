import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ShellPage } from "~/components/app-shell";
import { FamilyCharacters } from "~/components/family-library";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/_family/family/")({
  loader: async () => {
    try {
      return unwrapResult(FamilyLibraryResult)(await getFamilyLibrary());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function OurFamily() {
    const { characters, canEdit } = Route.useLoaderData();
    return (
      <ShellPage
        title="Our family"
        description="The people who star in your books. Choose how each one looks once, and every story draws them in its own style. They don't need an account."
      >
        <FamilyCharacters characters={characters} canEdit={canEdit} />
      </ShellPage>
    );
  },
});
