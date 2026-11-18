import { InvalidCredentials, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { SignInResult, signInWithPassword } from "~/server/accounts";

export const Route = createFileRoute("/sign-in")({ component: SignIn });

function SignIn() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      unwrapResult(SignInResult)(
        await signInWithPassword({ data: { email: String(form.get("email")), password: String(form.get("password")) } }),
      );
      await router.navigate({ to: "/" });
    } catch (caught) {
      setError(caught instanceof InvalidCredentials ? "That email and password don't match." : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Lifestory is invite-only.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" disabled={!hydrated || busy}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
