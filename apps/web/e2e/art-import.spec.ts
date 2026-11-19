import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Importing art made outside the app into a story draft: a layered PSD (plate, the girl drawn bald, her hair on its own
// layer, a hidden sketch) becomes the page's plate and her figure with its skin mask, overlay, and curly hair as a part;
// the image model draws her other face type; the part pipeline draws the rest; the author approves and publishes, and a
// family makes a book. A flat page goes through the image model to separate the girl from the scene. The worker's
// provider is the fake by default; with IMAGE_PROVIDER=openai in the environment the same flow runs on real edits.
const fixture = (file: string) => resolve("fixtures/imports", file);
const font = (file: string) => resolve("fixtures/stories/moon-picnic/fonts", file);

const evidence = async (page: Page, name: string, fullPage = true) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage });
};
const shoot = async (page: Page, testId: string, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.getByTestId(testId).screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png` });
};
const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);
const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("draft-state")).toContainText("Saved");
};
const setRect = async (page: Page, label: string, rect: readonly [number, number, number, number]) => {
  for (const [i, side] of (["left", "top", "right", "bottom"] as const).entries()) await page.getByLabel(`${label} ${side}`, { exact: true }).fill(String(rect[i]));
};

/** A new story by the operator with Literata, one role (a young child), on its Pages tab. */
const startStory = async (page: Page, title: string) => {
  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/author");
  const start = page.getByRole("form", { name: "Start a story" });
  await start.getByLabel("Title").fill(title);
  await start.getByLabel("Summary").fill("A kite gets away on a windy day.");
  await start.getByRole("button", { name: "Start the story" }).click();
  await expect(page).toHaveURL(/\/author\/story_/);
  await page.getByLabel("Font family").fill("Literata");
  for (const weight of ["450", "700"]) {
    await page.getByLabel("Font weight").selectOption(weight);
    await page.getByLabel("Upload a WOFF2 font file").setInputFiles(font(`literata-latin-${weight}-normal.woff2`));
    await expect(page.getByTestId("fonts")).toContainText(weight);
  }
  await page.getByLabel("Title font").selectOption("Literata");
  await page.getByLabel("Body font").selectOption("Literata");
  await page.getByLabel("Body weight").selectOption("450");
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByRole("button", { name: "Add a role" }).click();
  await save(page);
  await page.getByRole("tab", { name: "Pages" }).click();
};

const importTimeout = { timeout: 180_000 };

test("art import: a layered PSD becomes a page, its figure, and its hair; the story publishes and a family makes a book", async ({ browser }) => {
  test.setTimeout(600_000);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const title = `The Runaway Kite ${id}`;
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await startStory(page, title);
  await page.getByRole("textbox", { name: "Text block 1" }).fill("The kite flew up into the old oak, and {{hero.name}} looked up.");

  // 1. The PSD's layers, bottom to top, with a use suggested from each name; the hidden sketch is left out.
  const panel = page.getByTestId("art-import");
  await panel.getByLabel("Art file").setInputFiles(fixture("kite.psd"));
  const layers = panel.getByTestId("import-layers");
  await expect(layers.getByRole("listitem")).toHaveCount(4);
  await expect(panel.getByLabel("Use of Background")).toHaveValue("plate");
  await expect(panel.getByLabel("Use of Kid")).toHaveValue("figure");
  await expect(panel.getByLabel("Use of Hair")).toHaveValue("hair");
  await expect(panel.getByLabel("Use of Sketch")).toHaveValue("ignore");
  await panel.getByLabel("Drawn hair").selectOption("hair:curly");
  await shoot(page, "art-import", "import-1-layers");

  // 2. The import: plate, figure, skin mask, and the figure composed on the lightest and darkest skin for review.
  await panel.getByRole("button", { name: "Import", exact: true }).click();
  const review = panel.getByTestId("import-review");
  await expect(review).toBeVisible(importTimeout);
  for (const name of ["Plate", "Skin mask (tinted red)", "On the lightest skin", "On the darkest skin"]) {
    await expect(review.getByRole("img", { name })).toBeVisible();
  }
  await imagesLoaded(page);
  await shoot(page, "art-import", "import-2-review");
  await review.getByRole("button", { name: "Apply to this page" }).click();
  await expect(page.getByTestId("layer")).toHaveCount(2);
  await expect(page.getByTestId("base-cell").filter({ hasText: "Young child, round face" })).toHaveAttribute("data-ready", "true");
  await expect(page.getByTestId("part-cell").filter({ hasText: "Curly, young child, round face" })).toHaveAttribute("data-state", "unapproved");

  // 3. The other face type, drawn by the image model from the imported figure, applied as the oval base.
  await review.getByRole("button", { name: "Draw the oval face from it" }).click();
  await expect(review).toContainText("The other face type: Young child, oval face", importTimeout);
  await imagesLoaded(page);
  await shoot(page, "art-import", "import-3-other-face");
  await review.getByRole("button", { name: "Apply to this page" }).click();
  await expect(page.getByTestId("base-cell").filter({ hasText: "Young child, oval face" })).toHaveAttribute("data-ready", "true");
  await save(page);

  // 4. The part pipeline draws every other part from the imported bases; the author approves them all and publishes.
  await expect(page.getByTestId("parts-count")).toHaveText("1 of 20 drawn, 1 waiting for approval");
  await page.getByRole("button", { name: "Generate 19 missing parts" }).click();
  const generated = page.getByTestId("generated-part");
  await expect(generated).toHaveCount(19, { timeout: 60_000 });
  await expect.poll(() => generated.evaluateAll((parts) => parts.filter((p) => p.getAttribute("data-status") === "pending_review").length), { timeout: 300_000 }).toBe(19);
  await imagesLoaded(page);
  // The example (round face, short hair) is drawn now: plate, base, (face overlay,) and the generated short hair.
  await expect.poll(() => page.getByTestId("draft-preview").locator("img").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await imagesLoaded(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await evidence(page, "import-4-page", false);
  if (process.env.E2E_SCREENSHOTS) await page.getByTestId("figure-hero").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/import-5-parts.png`, style: ".sticky { position: static !important }" });
  for (const cell of await page.getByTestId("part-cell").filter({ has: page.getByTestId("generated-part") }).all()) {
    await cell.getByRole("button", { name: /^Approve generated/ }).click();
    await expect(cell).toHaveAttribute("data-state", "approved");
  }
  await page.getByRole("button", { name: "Approve every uploaded part of this figure" }).click();
  await expect(page.getByTestId("parts-count")).toHaveText("20 of 20 drawn, 0 waiting for approval");
  await save(page);
  await page.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("publish-issues")).toContainText("Ready to publish");
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByTestId("published-versions")).toContainText("Version 1 is published and can't change.");

  // 5. A family makes a book of it: a young child with curly hair is drawn with the imported curls.
  const child = `Ada ${id}`;
  await page.goto("/characters/new");
  await page.getByLabel("Name").fill(child);
  await page.getByLabel("Pronouns").selectOption("she/her");
  await page.getByRole("button", { name: "Young child", exact: true }).click();
  await page.getByRole("button", { name: "Curly black hair", exact: true }).click();
  await page.getByRole("button", { name: "Add to the family" }).click();
  await expect(page.getByTestId("characters")).toContainText(child);
  await page.getByTestId("stories").getByRole("link", { name: title }).click();
  const make = page.getByRole("form", { name: "Make our book" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByRole("button", { name: "Make the book" }).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const book = page.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(book.first()).toContainText(`The kite flew up into the old oak, and ${child} looked up.`);
  await imagesLoaded(page);
  // Plate, base, (face overlay,) and the imported curls: without them the figure couldn't be drawn at all.
  await expect.poll(() => page.getByTestId("editor-page").getByTestId("illustration").locator("img").count()).toBeGreaterThanOrEqual(3);
  await evidence(page, "import-6-book");
  await page.context().close();
});

test("art import: a flat page is separated into its plate and the figure", async ({ browser }) => {
  test.setTimeout(300_000);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await startStory(page, `Kite Day ${id}`);
  const panel = page.getByTestId("art-import");
  await panel.getByLabel("Art file").setInputFiles(fixture("kite-flat.jpg"));
  await setRect(page, "Where the character is", [250, 225, 625, 790]);
  await panel.getByLabel("Who to remove").fill("the little girl with curly hair in the yellow T-shirt, and the kite string in her hand");
  await panel.getByLabel("Drawn hair").selectOption("hair:curly");
  await setRect(page, "Where the hair is, in the character", [0, 0, 1000, 400]);
  await shoot(page, "art-import", "flat-1-box");
  await panel.getByRole("button", { name: "Import", exact: true }).click();
  const review = panel.getByTestId("import-review");
  await expect(review).toBeVisible(importTimeout);
  await expect(review.getByRole("img", { name: "Plate, with the character taken out" })).toBeVisible();
  await expect(review.getByRole("img", { name: "On the darkest skin" })).toBeVisible();
  await imagesLoaded(page);
  await shoot(page, "art-import", "flat-2-review");
  await review.getByRole("button", { name: "Apply to this page" }).click();
  await expect(page.getByTestId("layer")).toHaveCount(2);
  await expect(page.getByTestId("layer").first()).toHaveAttribute("data-kind", "art");
  await expect(page.getByTestId("part-cell").filter({ hasText: "Curly, young child, round face" })).toHaveAttribute("data-state", "unapproved");
  await save(page);
  // The example (short hair) has no short-hair part yet, so the preview shows the plate; with curls it draws her.
  await page.getByRole("tab", { name: "Roles" }).click();
  await page.getByLabel("Example hairstyle").selectOption("hair:curly");
  await page.getByRole("tab", { name: "Pages" }).click();
  await expect.poll(() => page.getByTestId("draft-preview").locator("img").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await imagesLoaded(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await evidence(page, "flat-3-page", false);
  await page.context().close();
});
