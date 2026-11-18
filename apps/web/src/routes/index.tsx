import { NotAuthenticated, unwrapResult } from "@lifestory/core/contracts";
import { createFileRoute, Link, redirect, useHydrated, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { FamilyPanel, InviteFamilyCard } from "~/components/family-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { NativeSelect } from "~/components/ui/native-select";
import { signOut, SignOutResult } from "~/server/accounts";
import { FamiliesResult, getFamilies, switchFamilyFn, SwitchFamilyResult } from "~/server/families";
import { getHome, getSampleFileStatus, HomeResult, SampleFileStatusResult, startSampleFile, StartSampleFileResult } from "~/server/functions";

export const Route = createFileRoute("/")({
  loader: async () => {
    try {
      const [home, families] = await Promise.all([getHome(), getFamilies()]);
      return { ...unwrapResult(HomeResult)(home), ...unwrapResult(FamiliesResult)(families) };
    } catch (error) {
      if (error instanceof NotAuthenticated) throw redirect({ to: "/sign-in" });
      throw error;
    }
  },
  component: Home,
});

type JobView =
  | { readonly phase: "idle" }
  | { readonly phase: "running"; readonly taskId: string; readonly state: string }
  | { readonly phase: "done"; readonly taskId: string; readonly key: string; readonly bytes: number }
  | { readonly phase: "error"; readonly message: string };

function Home() {
  const { user, families, stories, active, isOperator } = Route.useLoaderData();
  const router = useRouter();
  const [job, setJob] = useState<JobView>({ phase: "idle" });
  // The server-rendered button does nothing until React hydrates, so keep it disabled until then.
  const hydrated = useHydrated();

  const runJob = async () => {
    try {
      const { taskId } = unwrapResult(StartSampleFileResult)(await startSampleFile({ data: { label: `Hello from ${user.name}` } }));
      setJob({ phase: "running", taskId, state: "pending" });
      // Up to 4 minutes: with IMAGE_PROVIDER=modal a cold GPU start takes 1 to 2 minutes.
      for (let i = 0; i < 480; i++) {
        const status = unwrapResult(SampleFileStatusResult)(await getSampleFileStatus({ data: { taskId } }));
        if (status.state === "completed" && status.result) {
          setJob({ phase: "done", taskId, key: status.result.key, bytes: status.result.bytes });
          return;
        }
        if (status.state === "failed" || status.state === "cancelled") throw new Error(`task ${status.state}`);
        setJob({ phase: "running", taskId, state: status.state });
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error("timed out waiting for the worker");
    } catch (error) {
      setJob({ phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

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
      {isOperator && <InviteFamilyCard />}

      <Card>
        <CardHeader>
          <CardTitle>Stories</CardTitle>
          <CardDescription>Published stories, read from Postgres.</CardDescription>
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

      <Card>
        <CardHeader>
          <CardTitle>Worker check</CardTitle>
          <CardDescription>Spawns an Absurd task; the worker renders a placeholder and writes it to object storage.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button className="self-start" onClick={runJob} disabled={!hydrated || job.phase === "running"}>
            Write a sample file
          </Button>
          <div data-testid="job-status" className="text-sm">
            {job.phase === "running" && <p>Task {job.taskId}: {job.state}…</p>}
            {job.phase === "error" && <p className="text-destructive">Failed: {job.message}</p>}
            {job.phase === "done" && (
              <div className="flex flex-col gap-2">
                <p>
                  Stored <code>{job.key}</code> ({job.bytes} bytes)
                </p>
                <img src={`/api/files/${job.key}`} alt="Generated sample" className="w-80 rounded-md border" />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
