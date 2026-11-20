// Admin: the operator's tools, apart from Studio (making stories) and Family settings (one's own family). Only the
// operator reaches it: listing authors fails with Forbidden for anyone else, so the page is not found for them, and
// every action below checks the operator role on the server again.
import { Forbidden, NotAuthenticated, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, notFound, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { ShellPage } from "~/components/app-shell";
import { message } from "~/components/authoring/fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { AuthorsResult, ChangeAuthorsResult, grantAuthorFn, listAuthorsFn, revokeAuthorFn } from "~/server/authoring";
import { inviteFamilyFn, InviteFamilyResult } from "~/server/families";

export const Route = createFileRoute("/_family/admin")({
  loader: async () => {
    try {
      return { authors: unwrapResult(AuthorsResult)(await listAuthorsFn()) };
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      if (error instanceof Forbidden) throw notFound();
      throw error;
    }
  },
  component: function Admin() {
    const { authors } = Route.useLoaderData();
    return (
      <ShellPage title="Admin" description="Operator only: who can use Lifestory and who can write stories for it.">
        <section className="flex flex-col gap-3" aria-labelledby="admin-families">
          <h2 id="admin-families" className="text-lg font-semibold">
            Families
          </h2>
          <InviteFamilyCard />
        </section>
        <section className="flex flex-col gap-3" aria-labelledby="admin-authors">
          <h2 id="admin-authors" className="text-lg font-semibold">
            Authors
          </h2>
          <Authors authors={authors} />
        </section>
      </ShellPage>
    );
  },
});

/** The operator invites a new family: the account and its family are created now. */
function InviteFamilyCard() {
  const hydrated = useHydrated();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const { email } = unwrapResult(InviteFamilyResult)(
        await inviteFamilyFn({ data: { name: String(form.get("name")), email: String(form.get("email")) } }),
      );
      setStatus({ ok: true, text: `Invitation sent to ${email}. They choose a password from the emailed link.` });
      formElement.reset();
    } catch (error) {
      setStatus({ ok: false, text: message(error) });
    }
  };

  return (
    <Card data-testid="invite-family">
      <CardHeader>
        <CardTitle>Invite a new family</CardTitle>
        <CardDescription>
          Creates the account and its family; the invitee sets a password from the email.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit} aria-label="Invite a new family">
          <div className="flex min-w-40 flex-1 flex-col gap-2">
            <Label htmlFor="family-name">Name</Label>
            <Input id="family-name" name="name" required />
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-2">
            <Label htmlFor="family-email">Email</Label>
            <Input id="family-email" name="email" type="email" required />
          </div>
          <Button type="submit" disabled={!hydrated}>
            Invite family
          </Button>
        </form>
        {status && (
          <p className={status.ok ? "text-sm" : "text-sm text-destructive"} role="status">
            {status.text}
          </p>
        )}
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
      setStatus(
        cause instanceof NotFound
          ? `No account uses ${email}; invite them first.`
          : cause instanceof Forbidden
            ? cause.message
            : message(cause),
      );
    }
  };
  return (
    <Card data-testid="authors">
      <CardHeader>
        <CardTitle>Who can write stories</CardTitle>
        <CardDescription>
          You can always author. Let other accounts write and publish stories of their own in Studio.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col gap-1 text-sm">
          {authors.map((author) => (
            <li key={author.userId} className="flex flex-wrap items-center gap-x-2">
              {author.name} <span className="break-all text-muted-foreground">{author.email}</span>
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
        <form
          aria-label="Let someone author"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => void grant(event)}
        >
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm font-medium">
            Account email
            <Input name="email" type="email" required />
          </label>
          <Button type="submit" disabled={!hydrated}>
            Let them author
          </Button>
        </form>
        {status && (
          <p role="status" className="text-sm">
            {status}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
