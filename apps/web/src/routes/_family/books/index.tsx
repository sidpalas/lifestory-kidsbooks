import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { ShellPage } from "~/components/app-shell";
import { FamilyBooks } from "~/components/family-library";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";

export const Route = createFileRoute("/_family/books/")({
  loader: async () => {
    try {
      return unwrapResult(FamilyLibraryResult)(await getFamilyLibrary());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function Books() {
    const { books, canEdit } = Route.useLoaderData();
    return (
      <ShellPage title="Our books" description={canEdit ? "Open a book to edit its words and print a proof." : "The family's personalized books."}>
        <FamilyBooks books={books} canEdit={canEdit} />
      </ShellPage>
    );
  },
});
