// Authoring home (D37): the stories this author wrote and starting a new one. The operator's tools are in Admin.
import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { StudioBar } from "~/components/app-shell";
import { message } from "~/components/authoring/fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { AuthoringHomeResult, CreateStoryResult, createStoryFn, getAuthoringHome } from "~/server/authoring";

export const Route = createFileRoute("/author/")({
  loader: async () => {
    try {
      return unwrapResult(AuthoringHomeResult)(await getAuthoringHome());
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: AuthoringHome,
});

const slugify = (title: string) =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

function AuthoringHome() {
  const { canAuthor, stories } = Route.useLoaderData();
  return (
    <>
      <StudioBar />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-8">
        <h1 className="text-2xl font-semibold">Write stories</h1>
        {canAuthor ? (
          <>
            <NewStory />
            <Card>
              <CardHeader>
                <CardTitle>Your stories</CardTitle>
              </CardHeader>
              <CardContent>
                {stories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None yet.</p>
                ) : (
                  <ul className="flex flex-col gap-2" data-testid="authored-stories">
                    {stories.map((story) => (
                      <li key={story.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                        <div>
                          <Link
                            to="/author/$storyId"
                            params={{ storyId: story.id }}
                            className="font-medium hover:underline"
                          >
                            {story.title}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            /{story.slug} ·{" "}
                            {story.publishedVersion
                              ? `version ${story.publishedVersion} published`
                              : "not published yet"}
                            {story.status === "archived" && " · archived: hidden from families"}
                            {story.operatorOnly && " · operator only: hidden from families"}
                            {story.draftVersion && ` · drafting version ${story.draftVersion}`}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </>
        ) : (
          <p className="text-sm" data-testid="not-an-author">
            Writing stories is open to invited authors for now. Ask the operator to let you author.
          </p>
        )}
      </main>
    </>
  );
}

function NewStory() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  // Uncontrolled fields read on submit, like the family forms: typing before hydration isn't lost.
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const slug = String(form.get("slug") ?? "").trim() || slugify(title);
    try {
      const { id } = unwrapResult(CreateStoryResult)(
        await createStoryFn({ data: { title, slug, summary: String(form.get("summary") ?? "") } }),
      );
      await router.navigate({ to: "/author/$storyId", params: { storyId: id } });
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Start a story</CardTitle>
        <CardDescription>It stays a draft, visible only to you, until you publish its first version.</CardDescription>
      </CardHeader>
      <CardContent>
        <form aria-label="Start a story" className="flex flex-col gap-3" onSubmit={(event) => void create(event)}>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Title
            <Input name="title" required maxLength={120} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Address
            <Input name="slug" placeholder="made from the title" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={60} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Summary
            <Input name="summary" maxLength={500} />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="self-start" disabled={!hydrated}>
            Start the story
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
