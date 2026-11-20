// The link the operator's new-family invite emails (docs/decisions.md D23): the invitee's
// account and family already exist; choosing a password signs them in.
import { InviteInvalid, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";

import { PasswordFields } from "~/components/password-fields";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { getPasswordLink, PasswordLinkResult, setPassword, SetPasswordResult } from "~/server/accounts";

export const Route = createFileRoute("/set-password/$token")({
  loader: async ({ params }) => {
    try {
      return { account: unwrapResult(PasswordLinkResult)(await getPasswordLink({ data: { token: params.token } })) };
    } catch (error) {
      if (error instanceof InviteInvalid) return { account: null };
      throw error;
    }
  },
  component: SetPassword,
});

function SetPassword() {
  const { account } = Route.useLoaderData();
  const { token } = Route.useParams();
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!account)
    return (
      <main className="mx-auto max-w-md p-8">
        <Card>
          <CardHeader>
            <CardTitle>This link has expired</CardTitle>
            <CardDescription>It was already used or is more than a week old. Ask for a new invitation.</CardDescription>
          </CardHeader>
        </Card>
      </main>
    );

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password"));
    if (password !== String(form.get("confirm"))) return setError("The passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      unwrapResult(SetPasswordResult)(await setPassword({ data: { token, password } }));
      await router.navigate({ to: "/" });
    } catch (caught) {
      setError(caught instanceof InviteInvalid ? "This link has expired. Ask for a new invitation." : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Welcome, {account.name}</CardTitle>
          <CardDescription>Choose a password for {account.email}.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <PasswordFields />
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!hydrated || busy}>
              Set password and sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
