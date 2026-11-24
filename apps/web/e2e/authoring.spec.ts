import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

// Story authoring (D37), as an author does it: the operator lets an account author; the author starts a story, uploads
// static fonts and sets text styles and the photo style (D56), defines a role with its outfit and stock sheet, lays out a
// page with plate art, a placed figure (its bald reference and stock drawing) and scenery in front, writes text with
// tokens and sees it as BookPage prints it, checks, and publishes version 1. Then a family makes a book of it. Fresh
// accounts each run.
const art = (file: string) => resolve("fixtures/stories/kite-day", file);

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory: the whole page, or the viewport (the editor's sticky preview). */
const evidence = async (page: Page, name: string, fullPage = true) => {
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage });
};

const imagesLoaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length),
      { timeout: 30_000 },
    )
    .toBe(0);

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByTestId("draft-state")).toContainText("Saved");
};

/** Fills a rectangle field: four numbers in thousandths of the illustration. */
const setRect = async (page: Page, label: string, rect: readonly [number, number, number, number]) => {
  const fields = page.getByRole("group", { name: new RegExp(`^${label} \\(thousandths`) });
  for (const [i, side] of (["x0", "y0", "x1", "y1"] as const).entries())
    await fields.getByLabel(side, { exact: true }).fill(String(rect[i]));
};

test("authoring: an invited author writes, checks, and publishes a story, and a family makes a book of it", async ({
  browser,
}) => {
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
  await operator.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/admin");
  const grant = operator.getByRole("form", { name: "Let someone author" });
  await grant.getByLabel("Account email").fill(authorEmail);
  await grant.getByRole("button", { name: "Let them author" }).click();
  await expect(operator.getByRole("status")).toHaveText(`${authorEmail} can author stories now.`);
  await expect(operator.getByTestId("authors")).toContainText(authorEmail);
  await evidence(operator, "author-1-grant");
  await operator.context().close();

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
  // The photo style: a crop of a painted page and the style in words, for every family's sheets.
  await author.getByLabel("Style reference").setInputFiles(art("style/reference.svg"));
  await author.getByLabel("The style in words").fill("flat shapes and a thin dark outline");
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
    multipart: {
      folder: "pages/p01",
      file: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") },
    },
  });
  expect(upload.status()).toBe(403);

  // 4. A role: the child, young children only, with Mia as the stock character who plays it in previews, her outfit,
  // and her sheet.
  await author.getByRole("tab", { name: "Roles" }).click();
  await author.getByRole("button", { name: "Add a role" }).click();
  await expect(author.getByTestId("role-hero")).toContainText("{{hero.name}}");
  await author.getByLabel("Outfit on the sheet").fill("a yellow raincoat and blue boots");
  await author.getByLabel("Stock character sheet").setInputFiles(art("sheets/hero.svg"));
  await expect(author.getByTestId("role-hero").getByTestId("uploaded")).toHaveCount(1);
  await save(author);
  await evidence(author, "author-3-roles");

  // 5. The page: text with tokens, shown live as BookPage prints it, then plate art, the child, and foreground art.
  await author.getByRole("tab", { name: "Pages" }).click();
  await author.getByRole("button", { name: "Add a paragraph" }).click();
  await author
    .getByRole("textbox", { name: "Text block 2" })
    .fill("{{hero.name}} walked to the end of the garden. {{hero.They}} counted the stars with {{hero.their}} finger.");
  await expect(author.getByTestId("draft-preview")).toContainText(
    "Mia walked to the end of the garden. She counted the stars with her finger.",
  );
  await author.getByRole("textbox", { name: "Text block 2" }).fill("{{hero.name}} walked with {{friend.name}}.");
  await expect(author.getByRole("alert").filter({ hasText: 'unknown slot "friend"' })).toBeVisible();
  await author
    .getByRole("textbox", { name: "Text block 2" })
    .fill("{{hero.name}} walked to the end of the garden. {{hero.They}} counted the stars with {{hero.their}} finger.");

  // A second text frame (D54), placed by its inch fields and then by the keyboard, keeping the typed line break.
  await author.getByRole("button", { name: "A small frame to place" }).click();
  await author.getByRole("textbox", { name: "Text block 3" }).fill("Goodnight,\n{{hero.name}}!");
  await author.getByTestId("text-frame-fields-2").getByLabel("From left (in)").fill("4");
  const frame = author.getByRole("group", { name: /^Text frame 2:/ });
  await frame.focus();
  await frame.press("Shift+ArrowDown");
  await frame.press("Shift+ArrowDown");
  await expect(frame).toHaveAccessibleName(/^Text frame 2: 4\.00 in from the left, 0\.70 in from the top/);
  await expect(author.getByTestId("draft-preview").getByTestId("text-frame")).toHaveCount(2);

  await author.getByLabel("Add plate art").setInputFiles(art("pages/p01/plate.svg"));
  await expect(author.getByTestId("layer")).toHaveCount(1);
  await author.getByRole("button", { name: "Place The child" }).click();
  await author.getByLabel("Add scenery in front").setInputFiles(art("pages/p02/plate.svg"));
  await expect(author.getByTestId("layer")).toHaveCount(3);
  await expect(author.getByTestId("layer").nth(2)).toHaveAttribute("data-kind", "art");
  // The scenery was only to show the order; a plate in front would hide everything.
  await author.getByTestId("layer").nth(2).getByRole("button", { name: "Remove" }).click();
  await expect(author.getByTestId("layer")).toHaveCount(2);

  // 6. Checking lists what stops publishing: here, the figure's missing stock drawing.
  await save(author);
  await author.getByRole("button", { name: "Check" }).click();
  const issues = author.getByTestId("publish-issues");
  await expect(issues).toContainText("the figure needs its stock drawing");
  await issues.scrollIntoViewIfNeeded();
  await evidence(author, "author-5-check", false);

  // The figure: its bald reference, cut tight, and the stock character drawn on it, where they sit on the page.
  const figure = author.getByTestId("figure-fields");
  await figure.getByLabel("Bald reference (cut tight)").setInputFiles(art("pages/p01/hero/reference.svg"));
  await figure.getByLabel("Stock drawing (fills the window)").setInputFiles(art("pages/p01/hero/stock.svg"));
  await expect(figure.getByTestId("uploaded")).toHaveCount(2);
  await setRect(author, "Figure box", [520, 420, 700, 880]);
  await setRect(author, "Window", [408, 346, 812, 954]);
  await setRect(author, "Head", [567, 420, 653, 572]);
  await save(author);
  await imagesLoaded(author);
  // Plate and the stock figure.
  await expect(author.getByTestId("draft-preview").locator("img")).toHaveCount(2);
  await author.evaluate(() => window.scrollTo(0, 0));
  await evidence(author, "author-4-page", false);
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
  await stranger.context().close();

  // 8. A family makes a book of it: the author's own family, with a young child in the role.
  await author.goto("/stories");
  await author.getByTestId("stories").getByRole("link", { name: title }).click();
  const role = author.getByTestId("role-hero");
  await role.getByLabel("Name").fill(child);
  await role.getByLabel("Pronouns").selectOption("she/her");
  await author.getByRole("button", { name: "Make the book" }).click();
  await expect(author).toHaveURL(/\/books\/book_/);
  const pages = author.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(pages).toHaveCount(1);
  await expect(pages.first()).toContainText(
    `${child} walked to the end of the garden. She counted the stars with her finger.`,
  );
  // The published frame sits where the author put it, in inches from the trim plus the bleed, line break and all.
  const placed = pages.first().getByTestId("text-frame").nth(1);
  await expect(placed).toHaveCSS("left", "396px"); // (0.125 + 4) in × 96
  await expect(placed).toHaveCSS("top", "79.2px"); // (0.125 + 0.7) in × 96
  expect(await placed.innerText()).toBe(`Goodnight,\n${child}!`);
  await imagesLoaded(author);
  // Plate and the stock figure, until the book's figures are drawn from its sheets.
  await expect(author.getByTestId("editor-page").getByTestId("illustration").locator("img")).toHaveCount(2);
  await evidence(author, "author-7-book");

  // 9. Version 2 starts from version 1, and the author previews its text with Noor, from the family's book, in the role.
  await author.goto(`/author/${storyId}`);
  await author.getByRole("button", { name: "Start version 2" }).click();
  await author.getByLabel("Preview The child as").selectOption({ label: child });
  const draftPreview = author.getByTestId("draft-preview");
  await expect(draftPreview).toContainText(
    `${child} walked to the end of the garden. She counted the stars with her finger.`,
  );
  await expect(draftPreview.locator("img")).toHaveCount(2);
  await imagesLoaded(author);
  await evidence(author, "author-8-preview-as", false);
  await author.context().close();
});
