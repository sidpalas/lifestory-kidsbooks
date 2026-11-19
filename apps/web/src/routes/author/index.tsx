// Authoring home (D37): the stories this author wrote, starting a new one, and for the operator, who may author.
import { Forbidden, NotAuthenticated, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { message } from "~/components/authoring/fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  AuthoringHomeResult,
  AuthorsResult,
  ChangeAuthorsResult,
  CreateStoryResult,
  createStoryFn,
  getAuthoringHome,
  grantAuthorFn,
  listAuthorsFn,
  revokeAuthorFn,
} from "~/server/authoring";

export const Route = createFileRoute("/author/")({
  loader: async () => {
    try {
      const home = unwrapResult(AuthoringHomeResult)(await getAuthoringHome());
      return { ...home, authors: home.isOperator ? unwrapResult(AuthorsResult)(await listAuthorsFn()) : [] };
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
  const { canAuthor, isOperator, stories, authors } = Route.useLoaderData();
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-1">
        <Link to="/" className="text-muted-foreground text-sm hover:underline">
          ← Home
        </Link>
        <h1 className="text-2xl font-semibold">Write stories</h1>
      </header>
      {canAuthor ? (
        <>
          <NewStory />
          <Card>
            <CardHeader>
              <CardTitle>Your stories</CardTitle>
            </CardHeader>
            <CardContent>
              {stories.length === 0 ? (
                <p className="text-muted-foreground text-sm">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="authored-stories">
                  {stories.map((story) => (
                    <li key={story.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                      <div>
                        <Link to="/author/$storyId" params={{ storyId: story.id }} className="font-medium hover:underline">
                          {story.title}
                        </Link>
                        <p className="text-muted-foreground text-xs">
                          /{story.slug} · {story.publishedVersion ? `version ${story.publishedVersion} published` : "not published yet"}
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
      {isOperator && <Authors authors={authors} />}
    </main>
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
      const { id } = unwrapResult(CreateStoryResult)(await createStoryFn({ data: { title, slug, summary: String(form.get("summary") ?? "") } }));
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
            <p role="alert" className="text-destructive text-sm">
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

function Authors({ authors }: { authors: ReadonlyArray<{ userId: string; name: string; email: string }> }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const load = () => router.invalidate();
  const grant = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const email = String(new FormData(formElement).get("email") ?? "").trim();
    try {
      unwrapResult(ChangeAuthorsResult)(await grantAuthorFn({ data: { email } }));
      setStatus(`${email} can author stories now.`);
      formElement.reset();
      await load();
    } catch (cause) {
      setStatus(cause instanceof NotFound ? `No account uses ${email}; invite them first.` : cause instanceof Forbidden ? cause.message : message(cause));
    }
  };
  return (
    <Card data-testid="authors">
      <CardHeader>
        <CardTitle>Authors</CardTitle>
        <CardDescription>You can always author. Let other accounts write and publish stories of their own (D37).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {authors.map((author) => (
            <li key={author.userId} className="flex items-center gap-2">
              {author.name} <span className="text-muted-foreground">{author.email}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7"
                onClick={() => void revokeAuthorFn({ data: { userId: author.userId } }).then(load)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <form aria-label="Let someone author" className="flex items-end gap-2" onSubmit={(event) => void grant(event)}>
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
            Account email
            <Input name="email" type="email" required />
          </label>
          <Button type="submit" disabled={!hydrated}>
            Let them author
          </Button>
        </form>
        {status && <p role="status" className="text-sm">{status}</p>}
      </CardContent>
    </Card>
  );
}
