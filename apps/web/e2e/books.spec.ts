import { expect, type Page, test } from "@playwright/test";
import { Effect, Exit } from "effect";

// Characters, personalized books, and the editor (milestone 1 items 2, 4, 5). The seeded parent owns
// "The Example Family"; the seeded grandparent is a viewer in it. Names are unique per run.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory. */
const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};

const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);

const addCharacter = async (page: Page, name: string, pronouns: string, age: string, choices: ReadonlyArray<string>, refine: (picker: Page) => Promise<void> = async () => {}) => {
  await page.goto("/characters/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Pronouns").selectOption(pronouns);
  // Age first (D29): it decides which steps the picker offers. Then one choice per step (D50).
  await page.getByRole("button", { name: age, exact: true }).click();
  for (const choice of choices) await page.getByRole("button", { name: choice, exact: true }).click();
  await refine(page);
  await page.getByRole("button", { name: "Add to the family" }).click();
  await expect(page.getByTestId("characters")).toContainText(name);
};

/**
 * "Make the book", or "Make another copy" when the family already has a book of the story (D47): the seeded parent's
 * family keeps the books earlier tests and runs made.
 */
const makeBook = (page: Page) => page.getByRole("button", { name: /^(Make the book|Make another copy)$/ });

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

  // The picker starts from an age and changes one feature at a time, with the portrait following each choice. The
  // steps come in a fixed order, and there are no whole-look presets that would undo the ones below (D50).
  await addCharacter(page, child, "she/her", "Young child", [], async () => {
    const steps = await page.getByTestId("look-picker").getByRole("group").evaluateAll((groups) => groups.map((g) => g.getAttribute("aria-label")));
    expect(steps).toEqual(["1. Age", "2. Skin tone", "3. Face", "4. Hairstyle", "5. Hair colour", "6. Extras"]);
    const preview = page.getByTestId("look-preview");
    const before = await preview.getAttribute("src");
    // A toddler has no glasses parts, so the picker doesn't offer them; back to a young child, it does, and the
    // glasses chosen before come back (D50).
    await page.getByRole("button", { name: "Round glasses" }).click();
    await page.getByRole("button", { name: "Toddler", exact: true }).click();
    await expect(page.getByRole("group", { name: /Hairstyle/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Round glasses" })).toHaveCount(0);
    await expect(page.getByTestId("look-summary")).toHaveText("Toddler, round face, brown skin, curly black hair");
    await page.getByRole("button", { name: "Young child", exact: true }).click();
    await expect(page.getByTestId("look-summary")).toHaveText("Young child, round face, brown skin, curly black hair, glasses");
    await expect(page.getByRole("button", { name: "Round glasses" })).toHaveAttribute("aria-pressed", "true");
    // Pronouns order the hairstyles, likelier first, and never hide one (D29).
    const labels = (step: RegExp) => page.getByRole("group", { name: step }).getByRole("button").evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));
    await expect.poll(() => labels(/Hairstyle/)).toEqual(["Long hair", "Ponytail hair", "Braids hair", "Curly hair", "Bun hair", "Coily afro hair", "Locs hair", "Short hair", "Buzz cut hair"]);
    await page.getByLabel("Pronouns").selectOption("he/him");
    await expect.poll(() => labels(/Hairstyle/)).toEqual(["Short hair", "Buzz cut hair", "Curly hair", "Coily afro hair", "Locs hair", "Long hair", "Ponytail hair", "Braids hair", "Bun hair"]);
    await page.getByLabel("Pronouns").selectOption("she/her");
    await page.getByRole("button", { name: "Long hair" }).click();
    await page.getByRole("button", { name: "Brown hair colour" }).click();
    await page.getByRole("button", { name: "Round glasses" }).click();
    await expect(page.getByTestId("look-summary")).toHaveText("Young child, round face, brown skin, long brown hair, glasses");
    expect(await preview.getAttribute("src")).not.toBe(before);
    await imagesLoaded(page);
    await evidence(page, "picker");
  });
  // A title, separate from the name, is what the children call them; stories write it as {{grownup.title}}.
  await addCharacter(page, grownup, "they/them", "Older adult", ["Light skin", "Short hair", "Grey hair colour", "Round glasses"], async () => {
    await page.getByLabel(/What the kids call them/).fill("Grandpa");
  });
  await expect(page.getByTestId("characters")).toContainText("Grandpa · they/them");

  // Make a book: each role is filled by a family member of an age it accepts (the grown-up's role takes adults and
  // older adults).
  await page.goto("/stories/the-moon-picnic");
  const make = page.getByRole("list", { name: "Roles" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: grownup });
  // The story's pages show them at once, with their saved looks, before the book exists: the same 45 layers the
  // book composes below, and no example look pickers.
  await expect(page.getByTestId("pages-heading")).toHaveText(`The pages with ${child} and ${grownup}`);
  const preview = page.getByRole("region", { name: "Pages" }).getByTestId("book-page");
  await expect(preview.nth(2)).toContainText(`Grandpa checked the fuel. ${child} checked the cocoa.`);
  await imagesLoaded(page);
  await expect.poll(() => preview.locator("img").count()).toBe(45);
  await expect(page.getByTestId(/^try-/)).toHaveCount(0);
  await makeBook(page).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookUrl = page.url();

  const allPages = page.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(allPages).toHaveCount(6);
  await expect(allPages.nth(2)).toContainText(`Grandpa checked the fuel. ${child} checked the cocoa. She buckled herself in tight.`);
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

  // On a 320 px phone every preview shrinks to fit, as a whole square page (still 840 px laid out inside), and none
  // overlaps another or makes the page scroll sideways. Fixed scales once put the thumbnails on top of each other.
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const boxes = await page.getByTestId("book-page").evaluateAll((sheets) =>
    sheets.map((sheet) => {
      const box = sheet.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, layoutWidth: (sheet as HTMLElement).offsetWidth };
    }),
  );
  expect(boxes).toHaveLength(7);
  for (const [i, box] of boxes.entries()) {
    expect(box.layoutWidth).toBe(840);
    expect(box.right).toBeLessThanOrEqual(320);
    expect(box.right - box.left).toBeCloseTo(box.bottom - box.top, 0);
    for (const other of boxes.slice(i + 1)) {
      const overlaps = Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1;
      expect(overlaps).toBe(false);
    }
  }
  await evidence(page, "book-editor-320");
  await page.setViewportSize({ width: 1280, height: 720 });

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
  await page.getByTestId("role-hero").getByRole("link", { name: "Edit saved look" }).click();
  await page.getByRole("button", { name: "Blonde hair colour" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  // Saving returns to Characters; opening the book sooner can read the look from before the save.
  await expect(page).toHaveURL(/\/characters$/);
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
  await page.getByTestId("role-hero").getByRole("link", { name: "Edit saved look" }).click();
  await page.getByRole("button", { name: "Adult", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  // Saving returns to Characters; opening the book sooner can read the look from before the save.
  await expect(page).toHaveURL(/\/characters$/);
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
  await addCharacter(page, child, "he/him", "Older child", ["Dark brown skin", "Short hair", "Brown hair colour", "Round glasses"]);
  await addCharacter(page, `Lee ${id}`, "she/her", "Adult", ["Medium skin", "Oval face", "Long hair", "Brown hair colour"]);
  await page.goto("/stories/the-moon-picnic");
  const make = page.getByRole("list", { name: "Roles" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: `Lee ${id}` });
  await makeBook(page).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookUrl = new URL(page.url()).pathname;

  const viewer = await browser.newPage();
  await viewer.goto(`/__dev/log-me-in/grandparent@lifestory.dev?returnTo=${bookUrl}`);
  await expect(viewer.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(6);
  await expect(viewer.getByText("you're a viewer")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Save text/ })).toHaveCount(0);
  await expect(viewer.getByRole("textbox", { name: "Text block 1" })).toHaveAttribute("readonly", "");
  await viewer.goto("/characters");
  await expect(viewer.getByTestId("characters")).toContainText(child);
  await expect(viewer.getByRole("link", { name: "Add someone" })).toHaveCount(0);
  await viewer.getByRole("link", { name: new RegExp(child) }).click();
  await expect(viewer.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  // The viewer previews the story with the family but can't make or delete books.
  await viewer.goto("/stories/the-moon-picnic");
  await expect(viewer.getByTestId("story-books")).toContainText(child);
  await expect(makeBook(viewer)).toHaveCount(0);
  await viewer.goto(bookUrl);
  await expect(viewer.getByRole("button", { name: "Delete this book" })).toHaveCount(0);
  await viewer.goto("/books");
  await expect(viewer.getByTestId("books")).toContainText(child);
  await expect(viewer.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await viewer.close();

  // The story page lists the book; the parent deletes it from "Our books" after confirming, and it's gone everywhere.
  await page.goto("/stories/the-moon-picnic");
  await expect(page.getByTestId("story-books").getByRole("link", { name: new RegExp(child) })).toHaveAttribute("href", bookUrl);
  await page.goto("/books");
  const remove = page.getByRole("button", { name: new RegExp(`^Delete The Moon Picnic with .*${child}`) });
  const cancel = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await remove.click();
  await cancel;
  await expect(remove).toBeVisible();
  const confirm = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await remove.click();
  await confirm;
  await expect(remove).toHaveCount(0);
  await page.goto("/characters");
  await expect(page.getByTestId("characters")).toContainText(child);
  await page.goto(bookUrl);
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(page.getByRole("region", { name: "All pages" })).toHaveCount(0);
});

test("a parent styles a family member for one book before making it, without changing their saved look", async ({ page }) => {
  test.setTimeout(90_000);
  const id = unique();
  const child = `Wren ${id}`;
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await addCharacter(page, child, "she/her", "Young child", ["Very light skin", "Oval face", "Long hair", "Blonde hair colour"]);
  await addCharacter(page, `Ash ${id}`, "he/him", "Adult", ["Very light skin", "Oval face", "Short hair", "Blonde hair colour", "Round glasses"]);
  await page.goto("/stories/the-moon-picnic");
  const roles = page.getByRole("list", { name: "Roles" });
  await roles.getByLabel(/The child/).selectOption({ label: child });
  await roles.getByLabel(/A grown-up/).selectOption({ label: `Ash ${id}` });
  const preview = page.getByRole("region", { name: "Pages" }).getByTestId("book-page");
  await expect(page.getByTestId("pages-heading")).toHaveText(`The pages with ${child} and Ash ${id}`);
  await expect(makeBook(page)).toBeEnabled();
  await imagesLoaded(page);
  const sources = () => preview.locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")!));
  const before = await sources();

  // Red hair for this book only: the preview redraws her figures, and nothing is saved yet.
  await page.getByTestId("role-hero").getByRole("button", { name: "Change look for this book" }).click();
  const picker = page.getByTestId("book-look-hero");
  // Her own age only: an age change would draw someone else.
  await expect(picker.getByRole("group", { name: /Age/ }).getByRole("button")).toHaveText([/Young child/]);
  await picker.getByRole("button", { name: "Red hair colour" }).click();
  await expect(page).toHaveURL(/hair-colour%3Ared|hair-colour:red/);
  await expect(page.getByTestId("look-note-hero")).toContainText("a look for this book only");
  await expect.poll(async () => (await sources()).filter((src) => !before.includes(src)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  await imagesLoaded(page);
  const styled = await sources();
  expect(styled).toHaveLength(before.length);

  // The options hide by keyboard and come back as they were: Escape inside them, then Enter on the role's button.
  // Hiding keeps the change in the preview (and the URL) for "Make the book".
  const toggle = page.getByTestId("role-hero").getByRole("button", { name: "Hide look options" });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(picker).toContainText("hiding these options keeps it too");
  await picker.getByRole("button", { name: "Red hair colour" }).focus();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  const show = page.getByTestId("role-hero").getByRole("button", { name: "Change look for this book" });
  await expect(show).toBeFocused();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await expect(page).toHaveURL(/hair-colour%3Ared|hair-colour:red/);
  await expect(page.getByTestId("look-note-hero")).toContainText("a look for this book only");
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("button", { name: "Red hair colour" })).toHaveAttribute("aria-pressed", "true");
  await picker.getByRole("button", { name: `Done: hide ${child}'s look options` }).click();
  await expect(picker).toHaveCount(0);
  expect(await sources()).toEqual(styled);

  // Making the book keeps it; her saved look stays blonde.
  await makeBook(page).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookUrl = page.url();
  await expect(page.getByTestId("look-note-hero")).toBeVisible();
  await expect(page.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(6);
  await imagesLoaded(page);
  expect((await pageSources(page)).flat().filter((src) => src!.includes("/recoloured/")).toSorted()).toEqual(
    styled.filter((src) => src.includes("/recoloured/")).toSorted(),
  );
  await page.goto("/characters");
  await expect(page.getByTestId("characters").getByRole("link", { name: new RegExp(child) }).locator("img")).toHaveAttribute("src", /hair-colour%3Ablonde/);

  // Back to her saved look in the book.
  await page.goto(bookUrl);
  const bookPicker = page.getByTestId("book-look-hero");
  await bookPicker.getByRole("button", { name: "Brown hair colour" }).click();
  await expect(page.getByTestId("role-hero").locator("img")).toHaveAttribute("src", /hair-colour%3Abrown/);
  await page.reload();
  await expect(bookPicker.getByRole("button", { name: "Brown hair colour" })).toHaveAttribute("aria-pressed", "true");
  // Each choice is already saved, so hiding the options keeps the book's look; showing them again shows it.
  await expect(bookPicker).toContainText("saved to this book as you make it");
  await page.getByTestId("role-hero").getByRole("button", { name: "Hide look options" }).click();
  await expect(bookPicker).toHaveCount(0);
  await expect(page.getByTestId("look-note-hero")).toBeVisible();
  await expect(page.getByTestId("role-hero").locator("img")).toHaveAttribute("src", /hair-colour%3Abrown/);
  await page.getByTestId("role-hero").getByRole("button", { name: "Change look for this book" }).click();
  await expect(bookPicker.getByRole("button", { name: "Brown hair colour" })).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId(`book-look-hero`).getByRole("button", { name: `Use ${child}'s saved look` }).click();
  await expect(page.getByTestId("look-note-hero")).toHaveCount(0);
});

test("a family with a book of the story is sent to it instead of silently making another, and copies are made only on purpose", async ({ browser }) => {
  test.setTimeout(120_000);
  const id = unique();
  const email = `copies-${id}@lifestory.dev`;
  const child = `Pip ${id}`;
  const grownup = `Mo ${id}`;
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    // A new account comes with its own family, which has no books yet.
    await page.goto(`/__dev/log-me-in/${email}?returnTo=/`);
    await addCharacter(page, child, "she/her", "Young child", []);
    await addCharacter(page, grownup, "he/him", "Adult", ["Very light skin", "Oval face", "Short hair", "Blonde hair colour", "Round glasses"]);
    await page.goto("/stories/the-moon-picnic");
    const roles = page.getByRole("list", { name: "Roles" });
    await roles.getByLabel(/The child/).selectOption({ label: child });
    await roles.getByLabel(/A grown-up/).selectOption({ label: grownup });
    await expect(page).toHaveURL(/cast=/);
    await expect(page.getByTestId("story-books")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make the book" })).toBeEnabled();
    const storyUrl = page.url();

    // A second tab still shows the page from before the book existed.
    const stale = await context.newPage();
    await stale.goto(storyUrl);
    await expect(stale.getByRole("button", { name: "Make the book" })).toBeEnabled();

    await page.getByRole("button", { name: "Make the book" }).click();
    await expect(page).toHaveURL(/\/books\/book_/);
    const bookPath = new URL(page.url()).pathname;

    // The stale tab's "Make the book" makes nothing: it says why and lists the book that exists now.
    await stale.getByRole("button", { name: "Make the book" }).click();
    await expect(stale.getByRole("alert")).toHaveText("Your family already has a book of The Moon Picnic, so no new one was made.");
    await expect(stale.getByTestId("story-books")).toContainText("Your family already has a book of this story");
    await expect(stale.getByRole("link", { name: "Open our book" })).toHaveAttribute("href", bookPath);
    await expect(stale.getByRole("button", { name: "Make the book" })).toHaveCount(0);
    await stale.close();

    // Home sends the family to that book too: the story's card opens it instead of offering another (D48).
    await page.goto("/");
    const moonCard = page.getByTestId("stories").getByRole("listitem").filter({ hasText: "The Moon Picnic" });
    await expect(moonCard.getByRole("link", { name: "Open our book" })).toHaveAttribute("href", bookPath);

    // Back on the story page, styling the child for a book and opening the existing one leaves that book as it was.
    await page.goto(storyUrl);
    await expect(page.getByTestId("story-books")).toContainText(`The Moon Picnic with ${grownup}, ${child}`);
    await page.getByTestId("role-hero").getByRole("button", { name: "Change look for this book" }).click();
    await page.getByTestId("book-look-hero").getByRole("button", { name: "Red hair colour" }).click();
    await expect(page).toHaveURL(/hair-colour%3Ared|hair-colour:red/);
    await evidence(page, "story-has-book");
    await page.getByRole("link", { name: "Open our book" }).click();
    await expect(page).toHaveURL(new RegExp(`${bookPath}$`));
    await expect(page.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(6);
    await expect(page.getByTestId("look-note-hero")).toHaveCount(0);

    // Two requests at once that both saw only that book make one more copy, not two. Imported here (AGENTS.md,
    // "Orb size").
    const { createBook, Database, makeServerRuntime } = await import("@lifestory/core");
    const runtime = makeServerRuntime();
    const cast = JSON.parse(new URL(storyUrl).searchParams.get("cast")!) as Record<string, string>;
    const {
      rows: [owner],
    } = await runtime.runPromise(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query<{ userId: string; familyId: string }>(
            `select u.id as "userId", m.organization_id as "familyId" from "user" u join member m on m.user_id = u.id where u.email = $1`,
            [email],
          ),
        ),
      ),
    );
    const bookId = bookPath.split("/").at(-1)!;
    const attempts = await Promise.all(
      [0, 1].map(() => runtime.runPromise(Effect.exit(createBook(owner!.userId, owner!.familyId, { slug: "the-moon-picnic", cast, existing: [bookId] })))),
    );
    expect(attempts.filter(Exit.isSuccess)).toHaveLength(1);
    expect(JSON.stringify(attempts.find(Exit.isFailure))).toContain("BookExists");
    await runtime.dispose();

    // With several books the page doesn't pick one: each is listed, and another copy is made only on purpose.
    await page.goto(storyUrl);
    await expect(page.getByTestId("story-books")).toContainText("Your family already has 2 books of this story");
    await expect(page.getByTestId("story-books").getByRole("link")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Open our book" })).toHaveCount(0);
    await page.getByRole("button", { name: "Make another copy" }).click();
    await expect(page).toHaveURL(/\/books\/book_/);
    const newest = new URL(page.url()).pathname;
    expect(newest).not.toBe(bookPath);
    // Home picks up the newest book, and the story's card leaves the choice to the story page.
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Pick up where you left off" }).getByRole("link").first()).toHaveAttribute("href", newest);
    await expect(moonCard.getByRole("link", { name: "Our 3 books" })).toHaveAttribute("href", "/stories/the-moon-picnic");
    await expect(moonCard.getByRole("link", { name: "Open our book" })).toHaveCount(0);
    await page.goto("/books");
    await expect(page.getByTestId("books").getByRole("button", { name: /^Delete The Moon Picnic/ })).toHaveCount(3);
  } finally {
    await context.close();
  }
});
