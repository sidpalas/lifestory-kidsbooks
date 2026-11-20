// The link a family invitation emails. Someone new creates their account here (it joins
// the inviting family and gets no family of its own); someone with an account signs in
// and accepts, which adds the family to theirs and makes it active.
import { AccountExists, InviteInvalid, NotFound, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { PasswordFields } from "~/components/password-fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { acceptInvitationFn, AcceptInvitationResult, getInvitation, InvitationResult } from "~/server/accounts";

export const Route = createFileRoute("/invitations/$invitationId")({
  loader: async ({ params }) => {
    try {
      return unwrapResult(InvitationResult)(await getInvitation({ data: { invitationId: params.invitationId } }));
    } catch (error) {
      if (error instanceof InviteInvalid || error instanceof NotFound) return null;
      throw error;
    }
  },
  component: Invitation,
});

const roleText = (role: string) => (role === "viewer" ? "view its books" : "view and edit its books");

function Invitation() {
  const data = Route.useLoaderData();
  const { invitationId } = Route.useParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!data)
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>This invitation is no longer valid</CardTitle>
            <CardDescription>It was already accepted, canceled, or has expired. Ask for a new one.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  const { invitation, signedInEmail } = data;

  const accept = async (newAccount?: { name: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      unwrapResult(AcceptInvitationResult)(await acceptInvitationFn({ data: { invitationId, newAccount } }));
      await router.navigate({ to: "/" });
    } catch (caught) {
      setError(
        caught instanceof AccountExists
          ? "An account with this email already exists. Sign in, then open this link again."
          : caught instanceof Error
            ? caught.message
            : String(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  const submitNewAccount = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setError("The passwords don't match.");
    void accept({ name: String(form.get("name")), password });
  };

  const errorLine = error && (
    <p className="text-destructive text-sm" role="alert">
      {error}
    </p>
  );

  return (
    <main className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Join {invitation.familyName}</CardTitle>
          <CardDescription>
            {invitation.inviterName} invited {invitation.email} to {roleText(invitation.role)}.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {signedInEmail === invitation.email ? (
            <>
              {errorLine}
              <Button disabled={!hydrated || busy} onClick={() => void accept()}>
                Accept invitation
              </Button>
            </>
          ) : signedInEmail ? (
            <p className="text-sm">
              You're signed in as {signedInEmail}. This invitation is for {invitation.email}: sign out and sign in as
              that account to accept it.
            </p>
          ) : invitation.hasAccount ? (
            <p className="text-sm">
              <Link to="/sign-in" className="underline">
                Sign in
              </Link>{" "}
              as {invitation.email}, then open this link again to accept.
            </p>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={submitNewAccount}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
              <PasswordFields />
              {errorLine}
              <Button type="submit" disabled={!hydrated || busy}>
                Create account and join
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
