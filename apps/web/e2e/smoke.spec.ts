import { expect, test } from "@playwright/test";

test("unauthenticated visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByText("Lifestory is invite-only.")).toBeVisible();
});

test("seeded parent signs in, sees stories from Postgres, and the worker writes a file", async ({ page }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Pat Parent (parent@lifestory.dev)");
  await expect(page.getByTestId("stories")).toContainText("The Moon Picnic");

  await page.getByRole("button", { name: "Write a sample file" }).click();
  const status = page.getByTestId("job-status");
  await expect(status).toContainText(/Stored samples\/[0-9a-f-]+\.svg/, { timeout: 30_000 });

  // The image is served back from object storage through the authenticated file route.
  const image = status.getByRole("img", { name: "Generated sample" });
  await expect(image).toBeVisible();
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(600);
});

test("the dev sign-in route refuses off-site redirects", async ({ request }) => {
  const response = await request.get("/__dev/log-me-in/parent@lifestory.dev?returnTo=//evil.example", { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("/");
});

test("the dev index signs in as a listed user and log-me-out signs out", async ({ page }) => {
  await page.goto("/__dev");
  await page.getByRole("link", { name: "grandparent@lifestory.dev" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText("Signed in as Gran Viewer (grandparent@lifestory.dev)");

  await page.goto("/__dev/log-me-out?returnTo=/");
  await expect(page).toHaveURL(/\/sign-in$/);
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
