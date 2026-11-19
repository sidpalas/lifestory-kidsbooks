import { expect, type Page, test } from "@playwright/test";

// Characters, personalized books, and the editor (milestone 1 items 2, 4, 5). The seeded parent owns
// "The Example Family"; the seeded grandparent is a viewer in it. Names are unique per run.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory. */
const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};

const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);

const addCharacter = async (page: Page, name: string, pronouns: string, age: string, start: string, refine: (picker: Page) => Promise<void> = async () => {}) => {
  await page.goto("/characters/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Pronouns").selectOption(pronouns);
  // Age first (D29): it decides which curated looks and features the picker offers.
  await page.getByRole("button", { name: age, exact: true }).click();
  await page.getByRole("button", { name: start, exact: true }).click();
  await refine(page);
  await page.getByRole("button", { name: "Add to the family" }).click();
  await expect(page.getByTestId("characters")).toContainText(name);
};

/** The image URLs of every page in the editor's page list, per page. */
const pageSources = (page: Page) =>
  page
    .getByRole("region", { name: "All pages" })
    .getByTestId("book-page")
    .evaluateAll((pages) => pages.map((el) => [...el.querySelectorAll("img")].map((img) => img.getAttribute("src"))));

test("a parent adds family members, makes a book of them, edits a page's text, and a look change redraws every page", async ({ page }) => {
  test.setTimeout(120_000);
  const id = unique();
  const child = `Ada ${id}`;
  const grownup = `Sam ${id}`;
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");

  // The picker starts from an age and a curated look of it, and refines one feature at a time, with the portrait
  // following each choice.
  await addCharacter(page, child, "she/her", "Young child", "Curly black hair", async () => {
    const preview = page.getByTestId("look-preview");
    const before = await preview.getAttribute("src");
    // A toddler has no glasses parts, so the picker doesn't offer them; back to a young child, it does.
    await page.getByRole("button", { name: "Toddler", exact: true }).click();
    await expect(page.getByRole("group", { name: /Hairstyle/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Round glasses" })).toHaveCount(0);
    await expect(page.getByTestId("look-summary")).toHaveText("Toddler, round face, brown skin, curly black hair");
    await page.getByRole("button", { name: "Young child", exact: true }).click();
    await page.getByRole("button", { name: "Long hair" }).click();
    await page.getByRole("button", { name: "Brown hair colour" }).click();
    await page.getByRole("button", { name: "Round glasses" }).click();
    await expect(page.getByTestId("look-summary")).toHaveText("Young child, round face, brown skin, long brown hair, glasses");
    expect(await preview.getAttribute("src")).not.toBe(before);
    await imagesLoaded(page);
    await evidence(page, "picker");
  });
  await addCharacter(page, grownup, "they/them", "Older adult", "Short grey hair, glasses");

  // Make a book: each role is filled by a family member of an age it accepts (the grown-up's role takes adults and
  // older adults).
  await page.goto("/stories/the-moon-picnic");
  const make = page.getByRole("form", { name: "Make our book" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: grownup });
  await make.getByRole("button", { name: "Make the book" }).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookUrl = page.url();

  const allPages = page.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(allPages).toHaveCount(6);
  await expect(allPages.nth(2)).toContainText(`${grownup} checked the fuel. ${child} checked the cocoa. She buckled herself in tight.`);
  await imagesLoaded(page);
  // Composed from the cast's looks. The story preview with its example cast stacks 39 images (stories.spec.ts); Sam
  // has Grandpa Joe's parts (short hair, glasses) and Ada adds glasses to the child's 6 appearances: 39 + 6 = 45.
  expect((await pageSources(page)).flat()).toHaveLength(45);

  // Edit page 1's paragraph: the page shows the draft as it will print, then the saved text after a reload.
  const editor = page.getByTestId("editor-page");
  const block = page.getByRole("textbox", { name: "Text block 2" });
  await block.fill("{{hero.name}} packed the basket with {{hero.their}} favourite moon cheese.");
  await expect(editor).toContainText(`${child} packed the basket with her favourite moon cheese.`);
  // The editor shows the page at print size: 8.5 in trim + 2 × 0.125 in bleed = 840 CSS px before scaling.
  expect(await editor.getByTestId("book-page").evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(840);
  await page.getByRole("button", { name: "Save text block 2" }).click();
  await expect(page.getByText("Paragraph 2 · edited")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("editor-page")).toContainText(`${child} packed the basket with her favourite moon cheese.`);
  await imagesLoaded(page);
  await evidence(page, "book-editor");

  // A PDF proof of this book: its cast and text as they are now, rendered by the worker (D27).
  const proofs = page.getByRole("region", { name: "PDF proofs" });
  await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
  const proof = proofs.getByTestId("proof").first();
  await expect(proof).toContainText(`${child} & ${grownup}`);
  await expect(proof).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proof.getByRole("link", { name: /Download PDF \(6 pages/ })).toBeVisible();
  const pdfHref = await proof.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  if (process.env.E2E_SCREENSHOTS) (await import("node:fs")).writeFileSync(`${process.env.E2E_SCREENSHOTS}/book-proof.pdf`, await pdf.body());

  // A change to the character's look applies on every page: all 6 of Ada's appearances, and nothing else.
  const before = await pageSources(page);
  await page.getByTestId("role-hero").getByRole("link", { name: "Change look" }).click();
  await page.getByRole("button", { name: "Blonde hair colour" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.goto(bookUrl);
  await expect(allPages).toHaveCount(6);
  await imagesLoaded(page);
  const after = await pageSources(page);
  const changed = after.map((sources, i) => sources.filter((src, j) => src !== before[i]![j]).length);
  // Every page shows Ada, so every page has a layer recoloured with the new hair colour; the layer count is unchanged.
  expect(changed.every((count) => count >= 1)).toBe(true);
  expect(after.flat().length).toBe(before.flat().length);
  await evidence(page, "book-after-look-change");

  // Ada grows up: the child's role accepts young and older children, not adults, so her figures leave the pages and
  // the editor asks for someone else; the text still names her (D26, D29: no fallback to another age).
  await page.getByTestId("role-hero").getByRole("link", { name: "Change look" }).click();
  await page.getByRole("button", { name: "Adult", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.goto(bookUrl);
  await expect(page.getByTestId("role-hero").getByRole("status")).toContainText("Choose someone else for the child");
  await imagesLoaded(page);
  // Her 6 appearances (base, hair, glasses each) leave the pages: 45 - 18.
  expect((await pageSources(page)).flat()).toHaveLength(27);
});

test("a viewer reads the family's characters and books but can't change them", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const id = unique();
  const child = `Kit ${id}`;
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await addCharacter(page, child, "he/him", "Older child", "Short brown hair, glasses");
  await addCharacter(page, `Lee ${id}`, "she/her", "Adult", "Long brown hair");
  await page.goto("/stories/the-moon-picnic");
  const make = page.getByRole("form", { name: "Make our book" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: `Lee ${id}` });
  await make.getByRole("button", { name: "Make the book" }).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookUrl = new URL(page.url()).pathname;

  const viewer = await browser.newPage();
  await viewer.goto(`/__dev/log-me-in/grandparent@lifestory.dev?returnTo=${bookUrl}`);
  await expect(viewer.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(6);
  await expect(viewer.getByText("you're a viewer")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Save text/ })).toHaveCount(0);
  await expect(viewer.getByRole("textbox", { name: "Text block 1" })).toHaveAttribute("readonly", "");
  await viewer.goto("/");
  await expect(viewer.getByTestId("characters")).toContainText(child);
  await expect(viewer.getByRole("link", { name: "Add someone" })).toHaveCount(0);
  await viewer.getByRole("link", { name: new RegExp(child) }).click();
  await expect(viewer.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await viewer.close();
});
