import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

// Milestone 1 adds the invite and password sign-in forms here. Until then the
// only way in is the development sign-in route.
export const Route = createFileRoute("/sign-in")({ component: SignIn });

function SignIn() {
  return (
    <main className="mx-auto max-w-md p-8">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Lifestory is invite-only.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          In development, open <code>/dev/log-me-in/parent@lifestory.dev</code>.
        </CardContent>
      </Card>
    </main>
  );
}
