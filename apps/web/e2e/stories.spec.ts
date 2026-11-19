import { expect, test } from "@playwright/test";

test("a family member previews the sample story's pages at print size, with the story's font and art", async ({ page }) => {
  // The grandparent is a viewer and not the author: a published story is readable by anyone signed in.
  await page.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/");
  await page.getByTestId("stories").getByRole("link", { name: "The Moon Picnic" }).click();
  await expect(page).toHaveURL(/\/stories\/the-moon-picnic$/);
  await expect(page.getByTestId("story-meta")).toContainText("8.5 × 8.5 in · 6 pages");

  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(6);
  await expect(pages.first()).toContainText("Mia packed the picnic basket");
  await expect(pages.nth(2)).toContainText("Grandpa Joe checked the fuel. Mia checked the cocoa. She buckled herself in tight.");
  // Figures are composed from the example looks: no boxes unless the guides are on.
  await expect(page.getByTestId("figure-box")).toHaveCount(0);

  // 8.5 in trim + 0.125 in bleed on each side = 8.75 in = 840 CSS px, whatever the on-screen scale.
  for (const size of await pages.evaluateAll((els) => els.map((el) => [(el as HTMLElement).offsetWidth, (el as HTMLElement).offsetHeight]))) {
    expect(size).toEqual([840, 840]);
  }

  // Every layer loads: art, and each figure's recoloured base, parts and occluder. Counted by hand for the example
  // looks (Mia: curly hair; Grandpa Joe: short hair and glasses): pages 1 to 6 stack 5, 6, 7, 7, 7, 7 images.
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length))
    .toBe(0);
  expect(await pages.locator("img").count()).toBe(39);
  await expect
    .poll(() => page.evaluate(() => [...document.fonts].some((font) => font.family === "Literata" && font.status === "loaded")))
    .toBe(true);
  // Body text is set in points: 17 pt = 17/72 in = 22.67 CSS px.
  const fontSize = await pages.first().locator("p").last().evaluate((p) => parseFloat(getComputedStyle(p).fontSize));
  expect(fontSize).toBeCloseTo((17 * 96) / 72, 2);

  await expect(page.getByTestId("trim-guide")).toHaveCount(0);
  await page.getByLabel("Show trim, safe area, and figure boxes").check();
  await expect(page.getByTestId("trim-guide")).toHaveCount(6);
  await expect(page.getByTestId("figure-box")).toHaveCount(12);
  await expect(page.getByTestId("safe-guide")).toHaveCount(6);
});

test("changing a look recomposes every page that shows the character", async ({ page }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/stories/the-moon-picnic");
  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(6);
  const sources = () => pages.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  const before = await sources();

  // Glasses for Mia: one more part on each of her 6 appearances, and nothing else changes.
  await page.getByLabel("The child: Glasses").selectOption("glasses:round");
  await expect(page).toHaveURL(/glasses%3Around|glasses:round/);
  await expect.poll(async () => (await sources()).length, { timeout: 30_000 }).toBe(before.length + 6);
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length))
    .toBe(0);
  const after = await sources();
  expect(after.filter((src) => !before.includes(src))).toHaveLength(6);
});

test("story assets need a session and a story the user may read", async ({ page, request }) => {
  const asset = "/api/files/stories/story_moon_picnic/v3/pages/p01/background.svg";
  expect((await request.get(asset)).status()).toBe(401);

  await page.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/");
  const ok = await page.request.get(asset);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/svg+xml");
  expect(ok.headers()["content-security-policy"]).toBe("sandbox");
  expect((await page.request.get("/api/files/stories/story_moon_picnic/v99/pages/p01/background.svg")).status()).toBe(404);
  expect((await page.request.get("/api/files/stories/no_such_story/v1/pages/p01/background.svg")).status()).toBe(404);
});
