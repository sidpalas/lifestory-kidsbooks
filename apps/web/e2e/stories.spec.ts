import { expect, test } from "@playwright/test";

// A new account has a family with nobody in it yet; the story's pages show its own characters.
const newReader = () =>
  `/__dev/log-me-in/reader-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@lifestory.dev`;

test("a family member previews the sample story's pages at print size, with the story's font and art", async ({
  page,
}) => {
  // A new account, not the author: a published story is readable by anyone signed in.
  await page.goto(`${newReader()}?returnTo=/`);
  await page.getByTestId("stories").getByRole("link", { name: "The Kite Day" }).click();
  await expect(page).toHaveURL(/\/stories\/the-kite-day$/);
  await expect(page.getByTestId("story-meta")).toContainText("8.5 × 8.5 in · 3 pages");

  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(3);
  await expect(pages.first()).toContainText("Mia and Grandpa carried the big red kite up the windy hill.");
  await expect(pages.nth(2)).toContainText("“Same time tomorrow?” asked Grandpa. Mia nodded, all smiles.");
  // The illustrator's stock figures (D56): no boxes unless the guides are on.
  await expect(page.getByTestId("figure-box")).toHaveCount(0);

  // 8.5 in trim + 0.125 in bleed on each side = 8.75 in = 840 CSS px, whatever the on-screen scale.
  for (const size of await pages.evaluateAll((els) =>
    els.map((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]),
  )) {
    expect(size).toEqual([840, 840]);
  }

  // Every layer loads: each page's plate and one stock figure per appearance, 3 + 2 + 3 images.
  await expect
    .poll(() =>
      page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length),
    )
    .toBe(0);
  expect(await pages.locator("img").count()).toBe(8);
  await expect
    .poll(() =>
      page.evaluate(() => [...document.fonts].some((font) => font.family === "Literata" && font.status === "loaded")),
    )
    .toBe(true);
  // Body text is set in points: 17 pt = 17/72 in = 22.67 CSS px.
  const fontSize = await pages
    .first()
    .locator("p")
    .last()
    .evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
  expect(fontSize).toBeCloseTo((17 * 96) / 72, 2);

  // Trim and figure guides are for authors and the book editor, not the story page.
  await expect(page.getByTestId("trim-guide")).toHaveCount(0);
});

test("story assets need a session and a story the user may read", async ({ page, request }) => {
  const asset = "/api/files/stories/story_kite_day/v1/pages/p01/plate.svg";
  expect((await request.get(asset)).status()).toBe(401);

  await page.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/");
  const ok = await page.request.get(asset);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/svg+xml");
  expect(ok.headers()["content-security-policy"]).toBe("sandbox");
  expect((await page.request.get("/api/files/stories/story_kite_day/v99/pages/p01/plate.svg")).status()).toBe(404);
  expect((await page.request.get("/api/files/stories/no_such_story/v1/pages/p01/plate.svg")).status()).toBe(404);
});
