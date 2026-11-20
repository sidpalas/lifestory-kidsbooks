import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellPage } from "~/components/app-shell";
import { StoryList } from "~/components/family-library";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/_family/stories/")({
  loader: async () => {
    try {
      return unwrapResult(FamilyLibraryResult)(await getFamilyLibrary());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function Stories() {
    const { stories, books, canEdit } = Route.useLoaderData();
    return (
      <ShellPage
        title="Stories"
        description="Written and illustrated by people. Open one to see its pages with your family."
      >
        <StoryList stories={stories} books={books} canEdit={canEdit} />
      </ShellPage>
    );
  },
});
