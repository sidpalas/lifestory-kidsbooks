import { readFileSync } from "node:fs";
import { totalmem } from "node:os";

import { defineConfig, devices } from "@playwright/test";

// The end-to-end tests need Postgres and SeaweedFS running, migrated, and seeded
// (`mise run infra:up db:migrate db:seed` or .agents/setup). Playwright starts the web app
// and the worker itself, or reuses a web app already listening on port 3000.

// Playwright sets FORCE_COLOR=1 for the web servers and test workers it starts; with NO_COLOR also
// inherited (orbs set it), Node warns in every child that NO_COLOR is ignored. FORCE_COLOR wins anyway.
delete process.env.NO_COLOR;

/**
 * The memory everything this run starts can use: the machine's, or less where a cgroup caps it. An orb caps all agent
 * work, Docker included, at its workload slice's `memory.max` (AGENTS.md, "Orb size"), well under what `totalmem()`
 * reports; `process.constrainedMemory()` reports neither here.
 */
const memoryLimit = () => {
  let limit = totalmem();
  try {
    const path = readFileSync("/proc/self/cgroup", "utf8").match(/^0::(\/.*)$/m)?.[1] ?? "";
    for (let dir = path; dir !== ""; dir = dir.slice(0, dir.lastIndexOf("/"))) {
      const max = Number(readFileSync(`/sys/fs/cgroup${dir}/memory.max`, "utf8").trim());
      if (max > 0) limit = Math.min(limit, max);
    }
  } catch {
    // no cgroup v2 (macOS, Windows): the machine's memory
  }
  return limit;
};

const port = Number(process.env.E2E_PORT ?? 3000);
// The worker this run starts, by the version it beats with; e2e/global-setup.ts refuses to run next to any other.
// Set once in the runner, so its test workers, which load this file again, agree on it.
process.env.E2E_WORKER_VERSION ??= `e2e-${process.pid}`;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  globalSetup: "./apps/web/e2e/global-setup.ts",
  fullyParallel: true,
  // Since 300 ppi proof flattening (D35), two test workers' proof renders run out of memory on a1.small (3 GiB cap);
  // there, run one. `--workers=<n>` still overrides.
  workers: memoryLimit() < 6 * 1024 ** 3 ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "mise run dev:web",
      url: `${baseURL}/sign-in`,
      env: { PORT: String(port), BETTER_AUTH_URL: baseURL },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      // The only worker on the database while the tests run (e2e/global-setup.ts checks): Absurd hands each task to
      // whichever worker claims it first, with that worker's IMAGE_PROVIDER and print origin.
      command: "mise exec -- node apps/worker/src/main.ts",
      // It prints proofs from the web app these tests use; without this it printed from :3000 whatever E2E_PORT was.
      env: { PRINT_APP_URL: baseURL, APP_VERSION: process.env.E2E_WORKER_VERSION },
      wait: { stdout: /worker started/ },
      timeout: 60_000,
      // SIGTERM, not Playwright's default SIGKILL: the worker deletes its heartbeat as it stops, so the next run's
      // check doesn't count it for 35 s.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
    },
  ],
});
