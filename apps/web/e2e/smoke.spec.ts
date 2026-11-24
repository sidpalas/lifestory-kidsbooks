import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

test("signed-out visitors get the landing page, with public images and a way to sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Picture books starring your family");
  await expect(page.getByText("Lifestory is invite-only for now.").first()).toBeVisible();
  // Every image is a public marketing copy that loaded, not a story asset behind sign-in.
  const images = page.locator("main img");
  await expect(images).toHaveCount(3);
  for (const image of await images.all()) {
    await image.scrollIntoViewIfNeeded();
    expect(await image.getAttribute("src")).toMatch(/^\/(assets|src\/assets\/marketing)\//);
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
      .toBeGreaterThan(0);
  }
  const preview = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect((await page.request.get(new URL(preview ?? "").pathname)).headers()["content-type"]).toBe("image/png");

  await page.getByRole("main").getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Lifestory is invite-only.")).toBeVisible();
});

test("seeded parent signs in and sees stories from Postgres", async ({ page }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Pat Parent (parent@lifestory.dev)");
  await expect(page.getByTestId("families")).toHaveText("The Example Family");
  await expect(page.getByTestId("stories")).toContainText("The Kite Day");
});

test("health reports every migration and a live worker", async ({ request }) => {
  const journal = JSON.parse(readFileSync("packages/db/migrations/meta/_journal.json", "utf8")) as {
    entries: unknown[];
  };
  // Playwright starts a worker; its first beat follows "worker started" by a moment, hence the poll.
  await expect
    .poll(async () => (await request.get("/api/health")).json())
    .toMatchObject({
      status: "ok",
      migrations: journal.entries.length,
      workers: expect.arrayContaining([expect.objectContaining({ lastBeatSecondsAgo: expect.any(Number) })]),
    });
});

test("the dev sign-in route refuses off-site redirects", async ({ request }) => {
  const response = await request.get("/__dev/log-me-in/parent@lifestory.dev?returnTo=//evil.example", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/");
});

test("the dev index signs in as a listed user and log-me-out signs out", async ({ page }) => {
  await page.goto("/__dev");
  await page.getByRole("link", { name: "grandparent@lifestory.dev" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Gran Viewer (grandparent@lifestory.dev)");

  await page.goto("/__dev/log-me-out?returnTo=/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Picture books starring your family");
});

test("the operator cannot impersonate users", async ({ page }) => {
  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/auth/admin/impersonate-user", {
    data: { userId: "user_parent" },
    headers: { origin },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ code: "YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS" });
});
