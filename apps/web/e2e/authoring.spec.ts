import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";

// Story authoring (D37), as an author does it: the operator lets an account author; the author starts a story, uploads
// static fonts and sets text styles, defines a role, lays out a page with plate art, a placed figure (its bases, masks,
// and every part the look vocabulary needs) and foreground art, writes text with tokens and sees it as BookPage prints
// it, checks, approves the parts, and publishes version 1. Then a family makes a book of it. Fresh accounts each run.
const art = (file: string) => resolve("fixtures/stories/moon-picnic", file);

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory: the whole page, or the viewport (the editor's sticky preview). */
const evidence = async (page: Page, name: string, fullPage = true) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage });
};

const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("draft-state")).toContainText("Saved");
};

const setRect = async (page: Page, label: string, rect: readonly [number, number, number, number]) => {
  for (const [i, side] of (["left", "top", "right", "bottom"] as const).entries()) {
    await page.getByLabel(`${label} ${side}`, { exact: true }).fill(String(rect[i]));
  }
};

// Where the sample's placeholder hair and glasses sit on each child base, in thousandths of the figure box.
const faces = [
  { face: "round face", file: "child-1", hair: [260, 12, 740, 396], glasses: [388, 150, 612, 234] },
  { face: "oval face", file: "child-2", hair: [294, 3, 706, 406], glasses: [404, 148, 596, 236] },
] as const;
const hairstyles = [
  { label: "Short", file: "short" },
  { label: "Curly", file: "curly" },
  { label: "Long", file: "long" },
] as const;

test("authoring: an invited author writes, checks, and publishes a story, and a family makes a book of it", async ({ browser }) => {
  test.setTimeout(240_000);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const authorEmail = `author-${id}@example.com`;
  const title = `The Garden Walk ${id}`;
  const child = `Noor ${id}`;

  // An account that isn't an author can't open the authoring tools.
  const author = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await author.goto(`/__dev/log-me-in/${authorEmail}?returnTo=/author`);
  await expect(author.getByTestId("not-an-author")).toBeVisible();

  // 1. The operator lets the account author.
  const operator = await (await browser.newContext()).newPage();
  await operator.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/author");
  const grant = operator.getByRole("form", { name: "Let someone author" });
  await grant.getByLabel("Account email").fill(authorEmail);
  await grant.getByRole("button", { name: "Let them author" }).click();
  await expect(operator.getByRole("status")).toHaveText(`${authorEmail} can author stories now.`);
  await expect(operator.getByTestId("authors")).toContainText(authorEmail);
  await evidence(operator, "author-1-grant");
  await operator.close();

  // 2. The author starts a story; it opens on its version 1 draft.
  await author.reload();
  const start = author.getByRole("form", { name: "Start a story" });
  await start.getByLabel("Title").fill(title);
  await start.getByLabel("Summary").fill("A child walks through the garden at dusk.");
  await start.getByRole("button", { name: "Start the story" }).click();
  await expect(author).toHaveURL(/\/author\/story_/);
  const storyId = new URL(author.url()).pathname.split("/").pop()!;
  await expect(author.getByTestId("authoring-meta")).toContainText("drafting version 1");

  // 3. Trim stays 8.5 in square. Static fonts, one file per weight, and the text styles that use them.
  await author.getByLabel("Font family").fill("Literata");
  await author.getByLabel("Font weight").selectOption("450");
  await author.getByLabel("Upload a WOFF2 font file").setInputFiles(art("fonts/literata-latin-450-normal.woff2"));
  await expect(author.getByTestId("fonts")).toContainText("450");
  await author.getByLabel("Font weight").selectOption("700");
  await author.getByLabel("Upload a WOFF2 font file").setInputFiles(art("fonts/literata-latin-700-normal.woff2"));
  await expect(author.getByTestId("fonts")).toContainText("700");
  await author.getByLabel("Title font").selectOption("Literata");
  await author.getByLabel("Body font").selectOption("Literata");
  await author.getByLabel("Body weight").selectOption("450");
  await save(author);
  await evidence(author, "author-2-story-and-type");

  // A draft's files are the author's alone until a version is published.
  const fontAsset = (await author.getByTestId("fonts").locator("code").first().textContent())!;
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  expect((await stranger.request.get(`/api/files/stories/${storyId}/v1/${fontAsset}`)).status()).toBe(404);
  expect((await author.request.get(`/api/files/stories/${storyId}/v1/${fontAsset}`)).status()).toBe(200);
  const upload = await stranger.request.post(`/api/authoring/stories/${storyId}/assets`, {
    headers: { "x-lifestory-upload": "1" },
    multipart: { folder: "pages/p01", file: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") } },
  });
  expect(upload.status()).toBe(403);

  // 4. A role: the child, young children only, with Mia as the example who plays it in previews.
  await author.getByRole("tab", { name: "Roles" }).click();
  await author.getByRole("button", { name: "Add a role" }).click();
  await expect(author.getByTestId("role-hero")).toContainText("{{hero.name}}");
  await save(author);
  await evidence(author, "author-3-roles");

  // 5. The page: text with tokens, shown live as BookPage prints it, then plate art, the child, and foreground art.
  await author.getByRole("tab", { name: "Pages" }).click();
  await author.getByRole("button", { name: "Add a paragraph" }).click();
  await author.getByRole("textbox", { name: "Text block 2" }).fill("{{hero.name}} walked to the end of the garden. {{hero.They}} counted the stars with {{hero.their}} finger.");
  await expect(author.getByTestId("draft-preview")).toContainText("Mia walked to the end of the garden. She counted the stars with her finger.");
  await author.getByRole("textbox", { name: "Text block 2" }).fill("{{hero.name}} walked with {{friend.name}}.");
  await expect(author.getByRole("alert").filter({ hasText: 'unknown slot "friend"' })).toBeVisible();
  await author.getByRole("textbox", { name: "Text block 2" }).fill("{{hero.name}} walked to the end of the garden. {{hero.They}} counted the stars with {{hero.their}} finger.");

  await author.getByLabel("Add plate art").setInputFiles(art("pages/p01/background.svg"));
  await expect(author.getByTestId("layer")).toHaveCount(1);
  await author.getByRole("button", { name: "Place The child" }).click();
  await author.getByLabel("Add foreground art").setInputFiles(art("pages/p01/foreground.svg"));
  await expect(author.getByTestId("layer")).toHaveCount(3);
  await expect(author.getByTestId("layer").nth(2)).toHaveAttribute("data-kind", "art");
  await setRect(author, "Figure box", [430, 250, 760, 690]);

  // Bases: one per face type at the one age the role accepts, each with its skin and brow masks.
  for (const { face, file } of faces) {
    const at = `Young child, ${face}`;
    await author.getByLabel(`Base drawing: ${at}`).setInputFiles(art(`pages/p01/hero/base-${file}.svg`));
    await author.getByLabel(`Skin mask: ${at}`).setInputFiles(art(`pages/p01/hero/base-${file}-skin.svg`));
    await expect(author.getByTestId("base-cell").filter({ hasText: at })).toHaveAttribute("data-ready", "true");
    await author.getByLabel(`Brow mask: ${at}`).setInputFiles(art(`pages/p01/hero/base-${file}-brows.svg`));
    await expect(author.getByTestId("base-cell").filter({ hasText: at }).getByTestId("uploaded")).toHaveCount(3);
  }

  // Parts: one generated by the part pipeline (D36) from the saved base, with the worker's fake provider; the rest
  // uploaded and placed in the box. Both start unapproved.
  await expect(author.getByTestId("parts-count")).toHaveText("0 of 8 drawn, 0 waiting for approval");
  await expect(author.getByRole("button", { name: "Generate 8 missing parts" })).toBeDisabled();
  await save(author);
  const generatedAt = "Curly, young child, round face";
  await author.getByRole("button", { name: `Generate ${generatedAt}` }).click();
  const generatedCell = author.getByTestId("part-cell").filter({ hasText: generatedAt });
  await expect(generatedCell.getByTestId("generated-part")).toHaveAttribute("data-status", "pending_review", { timeout: 60_000 });
  await expect(generatedCell).toHaveAttribute("data-state", "unapproved");
  await expect(generatedCell.getByRole("img", { name: `${generatedAt} on dark skin` })).toBeVisible();
  for (const { face, file, hair, glasses } of faces) {
    for (const style of hairstyles) {
      const at = `${style.label}, young child, ${face}`;
      if (at === generatedAt) continue;
      await author.getByLabel(`Upload ${at}`).setInputFiles(art(`pages/p01/hero/${file}-${style.file}.svg`));
      await expect(author.getByTestId("part-cell").filter({ hasText: at })).toHaveAttribute("data-state", "unapproved");
      await setRect(author, `Place ${at}`, hair);
    }
    const at = `Round glasses, young child, ${face}`;
    await author.getByLabel(`Upload ${at}`).setInputFiles(art(`pages/p01/hero/${file}-glasses-round.svg`));
    await expect(author.getByTestId("part-cell").filter({ hasText: at })).toHaveAttribute("data-state", "unapproved");
    await setRect(author, `Place ${at}`, glasses);
  }
  await expect(author.getByTestId("parts-count")).toHaveText("8 of 8 drawn, 8 waiting for approval");
  await save(author);
  await imagesLoaded(author);
  // The example's look (Mia: round face, short brown hair) is composed from the uploaded base and parts.
  await expect(author.getByTestId("draft-preview").locator("img")).toHaveCount(4);
  if (process.env.E2E_SCREENSHOTS) await author.getByTestId("figure-hero").screenshot({ path: `${process.env.E2E_SCREENSHOTS}/author-4-figure.png`, style: ".sticky { position: static !important }" });
  await author.evaluate(() => window.scrollTo(0, 0));
  await evidence(author, "author-4-page", false);

  // 6. Checking lists what stops publishing: here, the parts nobody approved yet.
  await author.getByRole("button", { name: "Check" }).click();
  const issues = author.getByTestId("publish-issues");
  await expect(issues).toHaveAttribute("data-count", "8");
  await expect(issues).toContainText("not approved: p01: pages/p01/hero/");
  await issues.scrollIntoViewIfNeeded();
  await evidence(author, "author-5-check", false);

  await expect(issues).toContainText("not approved: p01: parts/");
  await author.getByRole("button", { name: "Approve every uploaded part of this figure" }).click();
  await expect(author.getByTestId("parts-count")).toHaveText("8 of 8 drawn, 1 waiting for approval");
  await save(author);
  // The generated part's review is in story_part: one Approve button, no save needed.
  await author.getByRole("button", { name: `Approve generated ${generatedAt}` }).click();
  await expect(generatedCell).toHaveAttribute("data-state", "approved");
  await expect(author.getByTestId("parts-count")).toHaveText("8 of 8 drawn, 0 waiting for approval");
  await author.getByRole("button", { name: "Check" }).click();
  await expect(issues).toHaveAttribute("data-count", "0");
  await expect(issues).toContainText("Ready to publish");

  // 7. Publishing makes version 1, which can't change; the story is in the catalogue.
  await author.getByRole("button", { name: "Publish version 1" }).click();
  await expect(author.getByTestId("published-versions")).toContainText("Version 1 is published and can't change.");
  await expect(author.getByRole("button", { name: "Start version 2" })).toBeVisible();
  await evidence(author, "author-6-published");
  await stranger.goto("/");
  await expect(stranger.getByTestId("stories")).toContainText(title);
  expect((await stranger.request.get(`/api/files/stories/${storyId}/v1/${fontAsset}`)).status()).toBe(200);
  await stranger.close();

  // 8. A family makes a book of it: the author's own family adds a young child with curly hair and a round face, so
  // her hair is the generated part the version published.
  await author.goto("/characters/new");
  await author.getByLabel("Name").fill(child);
  await author.getByLabel("Pronouns").selectOption("she/her");
  await author.getByRole("button", { name: "Young child", exact: true }).click();
  await author.getByRole("button", { name: "Curly black hair", exact: true }).click();
  await author.getByRole("button", { name: "Add to the family" }).click();
  await expect(author.getByTestId("characters")).toContainText(child);

  await author.getByTestId("stories").getByRole("link", { name: title }).click();
  const make = author.getByRole("form", { name: "Make our book" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByRole("button", { name: "Make the book" }).click();
  await expect(author).toHaveURL(/\/books\/book_/);
  const pages = author.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(pages).toHaveCount(1);
  await expect(pages.first()).toContainText(`${child} walked to the end of the garden. She counted the stars with her finger.`);
  await imagesLoaded(author);
  // Plate, base, generated curls, foreground: without the published part the figure couldn't be drawn at all.
  await expect(author.getByTestId("editor-page").getByTestId("illustration").locator("img")).toHaveCount(4);
  await evidence(author, "author-7-book");
});
