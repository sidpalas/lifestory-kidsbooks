import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell, ShellPage } from "~/components/app-shell";
import { StoryList } from "~/components/family-library";
import { Landing, landingHead } from "~/components/landing";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";
import { getHome, getLanding, HomeResult, LandingResult } from "~/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [home, library] = await Promise.all([getHome(), getFamilyLibrary()]);
      return {
        signedIn: true as const,
        shell: unwrapResult(HomeResult)(home),
        library: unwrapResult(FamilyLibraryResult)(library),
      };
    } catch (error) {
      // Signed-out visitors get the landing page instead of the app home.
      if (error instanceof NotAuthenticated)
        return { signedIn: false as const, ...unwrapResult(LandingResult)(await getLanding()) };
      throw error;
    }
  },
  head: ({ loaderData }) => (loaderData?.signedIn === false ? landingHead(loaderData) : {}),
  component: Index,
});

function Index() {
  return Route.useLoaderData().signedIn ? <Home /> : <Landing />;
}

// Home (D48): while a family is getting started, the next step first; then the book they made last, then stories.
function Home() {
  const data = Route.useLoaderData();
  if (!data.signedIn) throw new Error("Home renders only for signed-in visitors");
  const { shell, library } = data;
  const { characters, books, stories, canEdit } = library;
  const latest = books[0]; // The library lists books newest first.
  return (
    <AppShell shell={shell}>
      <ShellPage title="Home">
        {canEdit && (characters.length === 0 || books.length === 0) && <NextStep hasFamily={characters.length > 0} />}
        {latest && (
          <section className="flex flex-col gap-3" aria-labelledby="latest-book">
            <h2 id="latest-book" className="text-lg font-semibold">
              Pick up where you left off
            </h2>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <div className="min-w-0">
                <Link to="/books/$bookId" params={{ bookId: latest.id }} className="font-semibold hover:underline">
                  {latest.title}
                </Link>
                <p className="text-sm text-muted-foreground">With {latest.cast}</p>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/books/$bookId" params={{ bookId: latest.id }}>
                  {canEdit ? "Edit words and print" : "Read"}
                </Link>
              </Button>
            </div>
          </section>
        )}
        <section className="flex flex-col gap-3" aria-labelledby="home-stories">
          <h2 id="home-stories" className="text-lg font-semibold">
            {canEdit ? "Make a book" : "Stories"}
          </h2>
          <StoryList stories={stories} books={books} canEdit={canEdit} />
        </section>
      </ShellPage>
    </AppShell>
  );
}

/** Getting started, shown until the family has someone in it and a book (Sid, D48). */
function NextStep({ hasFamily }: { hasFamily: boolean }) {
  const steps = ["Add your family", "Make your first book", "Check the words and print a proof"];
  const current = hasFamily ? 1 : 0;
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border bg-card p-5"
      aria-labelledby="next-step"
      data-testid="next-step"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">Next step</p>
        <h2 id="next-step" className="text-xl font-semibold">
          {hasFamily ? "Choose a story and make your first book" : "Add your first family member"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {hasFamily
            ? "Pick who plays each part, and every page is drawn with them."
            : "Choose how they look: age, face, skin tone, hair, and glasses. No photos needed."}
        </p>
      </div>
      <ol className="grid grid-cols-3 gap-2 text-xs">
        {steps.map((step, index) => (
          <li
            key={step}
            aria-current={index === current ? "step" : undefined}
            className={cn(
              "border-t-4 pt-2",
              index < current && "border-primary",
              index === current && "border-primary font-semibold text-primary",
              index > current && "border-border text-muted-foreground",
            )}
          >
            {index < current ? `${step} · done` : step}
          </li>
        ))}
      </ol>
      <Button asChild className="self-start">
        {hasFamily ? <Link to="/stories">Choose a story</Link> : <Link to="/characters/new">Add someone</Link>}
      </Button>
    </section>
  );
}
