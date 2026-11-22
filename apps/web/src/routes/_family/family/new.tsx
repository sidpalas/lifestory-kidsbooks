import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { CharacterForm } from "~/components/character-form";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/_family/family/new")({
  loader: async () => {
    try {
      return unwrapResult(FamilyLibraryResult)(await getFamilyLibrary());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: () => <CharacterForm canEdit={Route.useLoaderData().canEdit} />,
});
