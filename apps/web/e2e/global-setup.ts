// Runs once, after the web app and this run's worker are up and before any test spawns a task. Every worker on the
// database takes tasks, so a worker this run didn't start (the orb's `worker` service, a preview worker with
// IMAGE_PROVIDER=openai, another thread's run) would take some of the tests' tasks: real providers bill them, a
// worker that prints from another origin fails proofs, and its memory sits next to the suite's under the orb's cap
// (AGENTS.md, "Orb size"). Refuse to start instead of relying on whoever runs the tests to remember.
import type { FullConfig } from "@playwright/test";

interface Health {
  workers?: { version: string | null; lastBeatSecondsAgo: number }[];
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]!.use.baseURL!;
  const ours = process.env.E2E_WORKER_VERSION;
  const response = await fetch(`${baseURL}/api/health`);
  if (!response.ok) throw new Error(`${baseURL}/api/health answered ${response.status}`);
  const { workers = [] } = (await response.json()) as Health;
  // Live: beat within one 30 s interval plus slack (health lists 90 s), as the verify CLI counts them.
  const others = workers.filter((worker) => worker.version !== ours && worker.lastBeatSecondsAgo <= 35);
  if (others.length === 0) return;
  throw new Error(
    `${others.length} other worker(s) share the e2e database (${others.map((w) => `${w.version ?? "no version"}, beat ${w.lastBeatSecondsAgo} s ago`).join("; ")}). ` +
      "They would take the tests' tasks, with whatever IMAGE_PROVIDER and print origin they started with. Stop them first: " +
      "`amp orb service stop worker` in an orb. A stopped worker clears within 35 s; `mise run verify -- e2e` waits for that itself.",
  );
}
