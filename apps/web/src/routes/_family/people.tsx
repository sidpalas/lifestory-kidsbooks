// People (D61): everyone in the family's ordered books, to pick for new books, edit for them, or archive.
import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ShellPage } from "~/components/app-shell";
import { PeopleList } from "~/components/people-list";
import { getPeopleFn, PeopleResult } from "~/server/books";

export const Route = createFileRoute("/_family/people")({
  loader: async () => {
    try {
      return unwrapResult(PeopleResult)(await getPeopleFn());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: function People() {
    const { people, canEdit } = Route.useLoaderData();
    return (
      <ShellPage
        title="People"
        description="Everyone in the books you've ordered. Pick them when you make another book instead of typing them again."
      >
        <PeopleList people={people} canEdit={canEdit} />
      </ShellPage>
    );
  },
});
