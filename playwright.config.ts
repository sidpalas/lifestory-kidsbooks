import { totalmem } from "node:os";
import { defineConfig, devices } from "@playwright/test";

// The end-to-end tests need Postgres and SeaweedFS running, migrated, and seeded
// (`mise run infra:up db:migrate db:seed` or .agents/setup). Playwright starts the web app
// and the worker itself, or reuses a web app already listening on port 3000.

// Playwright sets FORCE_COLOR=1 for the web servers and test workers it starts; with NO_COLOR also
// inherited (orbs set it), Node warns in every child that NO_COLOR is ignored. FORCE_COLOR wins anyway.
delete process.env.NO_COLOR;

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  fullyParallel: true,
  // Since 300 ppi proof flattening (D35), two test workers' proof renders run out of memory on a 4 GB orb
  // (a1.small); there, run one. `--workers=<n>` still overrides.
  workers: totalmem() < 6 * 1024 ** 3 ? 1 : undefined,
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
      // A second worker next to a running dev worker is harmless: Absurd hands each task to one claimant.
      command: "mise exec -- node apps/worker/src/main.ts",
      // It prints proofs from the web app these tests use; without this it printed from :3000 whatever E2E_PORT was.
      env: { PRINT_APP_URL: baseURL },
      wait: { stdout: /worker started/ },
      timeout: 60_000,
    },
  ],
});
