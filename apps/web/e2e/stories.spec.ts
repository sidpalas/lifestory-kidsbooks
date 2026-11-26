import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import { expectContained, SCREEN_WIDTHS } from "./layout.ts";

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

test("the story page lays pages out as the book's spreads: the cover alone, then 2 facing 3", async ({ page }) => {
  await page.goto(`${newReader()}?returnTo=/stories/the-kite-day`);
  const spreads = page.getByTestId("spread");
  await expect(spreads).toHaveCount(2);
  await expect(spreads.nth(0).getByTestId("book-page")).toHaveCount(1);
  await expect(spreads.nth(0)).toContainText("Cover");
  await expect(spreads.nth(0)).not.toContainText("Page 1");
  await expect(spreads.nth(1).getByTestId("book-page")).toHaveCount(2);
  await expect(spreads.nth(1)).toContainText("Page 2");
  await expect(spreads.nth(1)).toContainText("Page 3");

  const boxes = async () =>
    page
      .getByTestId("book-page")
      .evaluateAll((els) => els.map((el) => el.parentElement!.parentElement!.getBoundingClientRect().toJSON()));
  const section = (await page.getByRole("region", { name: "Pages" }).boundingBox())!;

  // Desktop: the cover sits in the middle of its own row; page 2 meets page 3 at the gutter, side by side.
  const [cover, left, right] = await boxes();
  expect(Math.abs(cover.x + cover.width / 2 - (section.x + section.width / 2))).toBeLessThan(2);
  expect(left.y).toBeGreaterThan(cover.bottom);
  expect(right.y).toBeCloseTo(left.y, 0);
  expect(right.x).toBeCloseTo(left.right, 0);

  // Phone: the pages stack in book order, each fitting the screen.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => (await boxes())[2]!.y > (await boxes())[1]!.bottom).toBe(true);
  for (const box of await boxes()) expect(box.right).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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

test("each story's card shows its cover: page 1 of the newest published version, in stock figures", async ({
  page,
}) => {
  // Imported here, not at the top (AGENTS.md, "Orb size").
  const { Database, importStoryVersion, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const fixture = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
  const readAsset = async (asset: string) => ({
    body: new Uint8Array(await readFile(new URL(asset, fixture))),
    contentType: { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
  });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const storyId = `story_e2e_cover_${id}`;
  const title = `Cover Picnic ${id}`;
  // Version 2 takes the grown-up off page 1, which stays the cover (page 3 has both roles); version 3 is an unpublished
  // draft.
  const v2 = structuredClone(manifest);
  v2.pages[0].illustration.layers = v2.pages[0].illustration.layers.filter(
    (layer: { slotId: string | null }) => layer.slotId !== "grownup",
  );
  try {
    await runtime.runPromise(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query(
            "insert into story (id, author_id, slug, title, summary, status, published_at) values ($1, 'user_operator', $2, $3, 'e2e', 'published', now())",
            [storyId, `e2e-cover-${id}`, title],
          ),
        ),
      ),
    );
    for (const [version, versionManifest, publishedAt] of [
      [1, manifest, new Date("2026-11-20T12:00:00Z")],
      [2, v2, new Date("2026-11-21T12:00:00Z")],
      [3, manifest, null],
    ] as const)
      await runtime.runPromise(
        importStoryVersion({
          id: `${storyId}_v${version}`,
          storyId,
          version,
          manifest: versionManifest,
          readAsset,
          publishedAt,
        }),
      );
  } finally {
    await runtime.dispose();
  }

  await page.goto(`${newReader()}?returnTo=/stories`);
  const cover = page.getByTestId("stories").getByRole("listitem").filter({ hasText: title }).getByTestId("story-cover");
  const files = `/api/files/stories/${storyId}/v2/pages/p01`;
  await expect(cover.locator("img")).toHaveCount(2);
  expect(await cover.locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")))).toEqual([
    `${files}/plate.svg`,
    `${files}/hero/stock.svg`,
  ]);
  await expect
    .poll(() =>
      cover.locator("img").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
    )
    .toBe(true);

  // The page's shape (8.75 in square with bleed), beside the text on a desktop and on a 320 px phone alike.
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const box = (await cover.boundingBox())!;
    expect(box.width).toBeGreaterThan(80);
    expect(box.height).toBeCloseTo(box.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  // The picture opens the story like its title, without a second link for screen readers.
  await expect(page.getByTestId("stories").getByRole("link", { name: title })).toHaveCount(1);
  await cover.click();
  await expect(page).toHaveURL(new RegExp(`/stories/e2e-cover-${id}$`));
});

test("a story card keeps its summary beside the cover readable and its button inside, at every width", async ({
  page,
}) => {
  // Between 640 and ~900 px the sidebar leaves the list half the window: two columns there squeezed the summary to a
  // word per line and pushed the button out of the card (Sid, 2026-11-25).
  await page.goto(`${newReader()}?returnTo=/`);
  const card = page
    .getByTestId("stories")
    .locator(":scope > li")
    .filter({ has: page.getByRole("link", { name: "The Kite Day", exact: true }) });
  for (const width of SCREEN_WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expectContained(card);
    const cover = (await card.getByTestId("story-cover").boundingBox())!;
    const summary = (await card.getByText("A child and a grown-up fly a kite").boundingBox())!;
    expect(summary.width, `at ${width} px`).toBeGreaterThanOrEqual(cover.width);
  }
});
