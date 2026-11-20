import { expect, test } from "@playwright/test";

// A new account has a family with nobody in it yet, so the story's pages show its example characters.
const newReader = () => `/__dev/log-me-in/reader-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}@lifestory.dev`;

test("a family member previews the sample story's pages at print size, with the story's font and art", async ({ page }) => {
  // A new account, not the author: a published story is readable by anyone signed in.
  await page.goto(`${newReader()}?returnTo=/`);
  await page.getByTestId("stories").getByRole("link", { name: "The Moon Picnic" }).click();
  await expect(page).toHaveURL(/\/stories\/the-moon-picnic$/);
  await expect(page.getByTestId("story-meta")).toContainText("8.5 × 8.5 in · 6 pages");

  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(6);
  await expect(pages.first()).toContainText("Mia packed the picnic basket");
  await expect(pages.nth(2)).toContainText("Grandpa checked the fuel. Mia checked the cocoa. She buckled herself in tight.");
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

  // Trim and figure guides are for authors and the book editor, not the story page.
  await expect(page.getByTestId("trim-guide")).toHaveCount(0);
});

test("the watercolour sample's raster art loads and recolours on every page", async ({ page }) => {
  await page.goto(`${newReader()}?returnTo=/`);
  await page.getByTestId("stories").getByRole("link", { name: "The Paper Boat" }).click();
  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(3);
  await expect(pages.first()).toContainText("After the rain, Leo and Mum folded");
  // JPEG plates, a WebP foreground, recoloured PNG figures, and each figure's overlay (blush, mouth) drawn as is.
  // Example looks (Leo: short hair and glasses; Mum: curly hair), each page in other poses (v3): pages 1 to 3 stack 8,
  // 9 (the reeds in front), and 9 images (Mum's hand in front of her face, the occluder, recoloured too).
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 })
    .toBe(0);
  const sources = await pages.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  expect(sources).toHaveLength(26);
  expect(sources.filter((src) => src.includes("/recoloured/"))).toHaveLength(13);
  expect(sources.filter((src) => /\.(jpg|webp)$/.test(src))).toHaveLength(4);
});

test("trying a look on the story's example recomposes every page that shows the character", async ({ page }) => {
  await page.goto(`${newReader()}?returnTo=/stories/the-moon-picnic`);
  const pages = page.getByTestId("book-page");
  await expect(pages).toHaveCount(6);
  const sources = () => pages.locator("img").evaluateAll((imgs) => imgs.map((img) => (img as HTMLImageElement).src));
  const before = await sources();

  // Nobody in the family fits, so the roles show the examples, and their look pickers open on request. Trying looks
  // is a preview: nothing to make a book from yet.
  await expect(page.getByTestId("role-hero")).toContainText("Nobody in your family is a young child or older child yet.");
  await expect(page.getByRole("button", { name: "Make the book" })).toBeDisabled();
  await page.getByRole("button", { name: "Try looks on Mia" }).click();
  const picker = page.getByTestId("try-hero");
  await expect(picker).toContainText("Mia is the story's example character, not someone in your family.");
  // The child's role takes young and older children only.
  await expect(picker.getByRole("group", { name: /Age/ }).getByRole("button")).toHaveText([/Young child/, /Older child/]);

  // Glasses for Mia: one more part on each of her 6 appearances, and nothing else changes. The page stays where the
  // reader scrolled to, though the look is kept in the URL.
  const glasses = picker.getByRole("button", { name: "Round glasses" });
  await expect(glasses).toBeEnabled();
  await glasses.evaluate((button) => button.scrollIntoView({ block: "center" }));
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  await glasses.click();
  await expect(page).toHaveURL(/glasses%3Around|glasses:round/);
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await expect.poll(async () => (await sources()).length, { timeout: 30_000 }).toBe(before.length + 6);
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length))
    .toBe(0);
  const after = await sources();
  expect(after.filter((src) => !before.includes(src))).toHaveLength(6);
  // The preview survives a reload.
  await page.reload();
  await expect(page.getByTestId("try-hero").getByRole("button", { name: "Round glasses" })).toHaveAttribute("aria-pressed", "true");
});

test("on a phone, the example's look options hide with a tap and come back as they were", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });
  try {
    const page = await context.newPage();
    await page.goto(`${newReader()}?returnTo=/stories/the-moon-picnic`);
    const role = page.getByTestId("role-hero");
    await role.getByRole("button", { name: "Try looks on Mia" }).tap();
    const picker = page.getByTestId("try-hero");
    await picker.getByRole("button", { name: "Round glasses" }).tap();
    await expect(page).toHaveURL(/glasses%3Around|glasses:round/);
    await expect(role.getByRole("button", { name: "Hide look options" })).toHaveAttribute("aria-expanded", "true");

    // "Done" sits beside the title on a phone, inside the screen; hiding keeps the look on the pages.
    const done = picker.getByRole("button", { name: "Done: hide look options for Mia" });
    const box = (await done.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    await done.tap();
    await expect(picker).toHaveCount(0);
    await expect(page).toHaveURL(/glasses%3Around|glasses:round/);
    const toggle = role.getByRole("button", { name: "Try looks on Mia" });
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    // Showing it again keeps the glasses rather than starting over.
    await toggle.tap();
    await expect(picker.getByRole("button", { name: "Round glasses" })).toHaveAttribute("aria-pressed", "true");
    await role.getByRole("button", { name: "Hide look options" }).tap();
    await expect(picker).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("story assets need a session and a story the user may read", async ({ page, request }) => {
  const asset = "/api/files/stories/story_moon_picnic/v5/pages/p01/background.svg";
  expect((await request.get(asset)).status()).toBe(401);

  await page.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/");
  const ok = await page.request.get(asset);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("image/svg+xml");
  expect(ok.headers()["content-security-policy"]).toBe("sandbox");
  expect((await page.request.get("/api/files/stories/story_moon_picnic/v99/pages/p01/background.svg")).status()).toBe(404);
  expect((await page.request.get("/api/files/stories/no_such_story/v1/pages/p01/background.svg")).status()).toBe(404);
});
