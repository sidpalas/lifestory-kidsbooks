import { defineConfig, devices } from "@playwright/test";

// The smoke test needs Postgres and SeaweedFS running, migrated, and seeded
// (`mise run infra:up db:migrate db:seed` or .agents/setup). It starts the web app
// and the worker itself, or reuses a web app already listening on port 3000.

// Playwright sets FORCE_COLOR=1 for the web servers and test workers it starts; with NO_COLOR also
// inherited (orbs set it), Node warns in every child that NO_COLOR is ignored. FORCE_COLOR wins anyway.
delete process.env.NO_COLOR;

const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "apps/web/e2e",
  fullyParallel: true,
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
      wait: { stdout: /worker started/ },
      timeout: 60_000,
    },
  ],
});
