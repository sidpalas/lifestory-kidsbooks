import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, useHydrated, useRouter } from "@tanstack/react-router";
import { Button } from "~/components/ui/button";
import { FamilyLibrary } from "~/components/family-library";
import { FamilyPanel, InviteFamilyCard } from "~/components/family-panel";
import { Landing, landingHead } from "~/components/landing";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/native-select";
import { signOut, SignOutResult } from "~/server/accounts";
import { FamilyLibraryResult, getFamilyLibrary } from "~/server/books";
import { FamiliesResult, getFamilies, switchFamilyFn, SwitchFamilyResult } from "~/server/families";
import { getHome, getLanding, HomeResult, LandingResult } from "~/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [home, families, library] = await Promise.all([getHome(), getFamilies(), getFamilyLibrary()]);
      return {
        signedIn: true as const,
        ...unwrapResult(HomeResult)(home),
        ...unwrapResult(FamiliesResult)(families),
        library: unwrapResult(FamilyLibraryResult)(library),
      };
    } catch (error) {
      // Signed-out visitors get the landing page instead of the app home.
      if (error instanceof NotAuthenticated) return { signedIn: false as const, ...unwrapResult(LandingResult)(await getLanding()) };
      throw error;
    }
  },
  head: ({ loaderData }) => (loaderData?.signedIn === false ? landingHead(loaderData) : {}),
  component: Index,
});

function Index() {
  return Route.useLoaderData().signedIn ? <Home /> : <Landing />;
}

function Home() {
  const data = Route.useLoaderData();
  if (!data.signedIn) throw new Error("Home renders only for signed-in visitors");
  const { user, families, stories, active, isOperator, library, canAuthor } = data;
  const router = useRouter();
  // The server-rendered button does nothing until React hydrates, so keep it disabled until then.
  const hydrated = useHydrated();

  const switchTo = async (familyId: string) => {
    unwrapResult(SwitchFamilyResult)(await switchFamilyFn({ data: { familyId } }));
    await router.invalidate();
  };

  const leave = async () => {
    unwrapResult(SignOutResult)(await signOut());
    await router.navigate({ to: "/sign-in" });
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Lifestory</h1>
        <div className="flex flex-col items-end gap-1 text-right text-sm">
          <p className="text-muted-foreground" data-testid="signed-in-as">
            Signed in as {user.name} ({user.email})
          </p>
          {/* The switcher appears once someone is in more than one family (D3: say little about families until then). */}
          {families.length > 1 ? (
            <NativeSelect
              aria-label="Family"
              value={active?.id}
              disabled={!hydrated}
              onChange={(event) => void switchTo(event.target.value)}
            >
              {families.map((family) => (
                <option key={family.id} value={family.id}>
                  {family.name}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <p className="font-medium" data-testid="families">
              {active?.name ?? "Not in a family yet"}
            </p>
          )}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => void leave()} disabled={!hydrated}>
            Sign out
          </Button>
        </div>
      </header>

      {active && <FamilyPanel family={active} />}
      <FamilyLibrary characters={library.characters} books={library.books} canEdit={library.canEdit} />
      {isOperator && <InviteFamilyCard />}
      {(canAuthor || isOperator) && (
        <Card>
          <CardHeader>
            <CardTitle>Write stories</CardTitle>
            <CardDescription>Author a story: pages, art, roles, and text, published as a version families can make books of.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/author" className="font-medium hover:underline">
              Open your stories →
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Stories</CardTitle>
          <CardDescription>Published stories you can make into a book with your family.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3" data-testid="stories">
            {stories.map((story) => (
              <li key={story.id} className="rounded-md border p-3">
                <Link to="/stories/$slug" params={{ slug: story.slug }} className="font-medium hover:underline">
                  {story.title}
                </Link>
                <p className="text-muted-foreground text-sm">{story.summary}</p>
                <p className="text-muted-foreground mt-1 text-xs">by {story.authorName}</p>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </main>
  );
}
