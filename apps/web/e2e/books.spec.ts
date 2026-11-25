import type { ServerServices } from "@lifestory/core";
import { expect, type Page, test } from "@playwright/test";
import { Effect, Exit } from "effect";

import { giveSheets, markDrawn, markShownBookDrawn } from "./drawn.ts";
import { expectFieldsAligned } from "./layout.ts";

// Personalized books, who plays each role, and the editor (milestone 1 items 2, 4, 5). The seeded parent owns
// "The Example Family"; the seeded grandparent is a viewer in it. Names are unique per run.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory. */
const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};

const imagesLoaded = (page: Page) =>
  expect
    .poll(
      () => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length),
      { timeout: 30_000 },
    )
    .toBe(0);

type Person = { name: string; title?: string; pronouns: string; age: string };

/** Fills one role on the story page: who plays it (D56; no separate family members since Sid, 2026-11-24). */
const fillRole = async (page: Page, slotId: string, person: Person) => {
  const role = page.getByTestId(`role-${slotId}`);
  await role.getByLabel("Name").fill(person.name);
  if (person.title) await role.getByLabel(/What the kids call them/).fill(person.title);
  await role.getByLabel("Pronouns").selectOption(person.pronouns);
  await role.getByLabel("Age").selectOption({ label: person.age });
};

/** Fills both roles of The Kite Day. */
const castKiteDay = async (page: Page, hero: Person, grownup: Person) => {
  await fillRole(page, "hero", hero);
  await fillRole(page, "grownup", grownup);
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

test("a parent says who plays each role, makes a book, edits a page's text, and changes who plays a role", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const id = unique();
  const child = `Ada ${id}`;
  const grownup = `Sam ${id}`;
  // A family of its own: the seeded parent's family gets books from the other tests while this one runs, and making a
  // book refuses when the family's books changed since the page loaded (D47).
  await page.goto(`/__dev/log-me-in/ada-${id}@lifestory.dev?returnTo=/`);

  // Make a book: each role gets a person of an age it accepts (the grown-up's role offers only adult and older adult).
  // A title, separate from the name, is what the children call them; stories write it as {{grownup.title}}.
  await page.goto("/stories/the-kite-day");
  await expect(page.getByTestId("role-grownup").getByLabel("Age").locator("option")).toHaveText([
    "Adult",
    "Older adult",
  ]);
  await expect(makeBook(page)).toBeDisabled();
  // Only an adult has a title, what the kids call them (Sid, 2026-11-25): the child's role doesn't ask for one.
  await expect(page.getByTestId("role-hero").getByLabel(/What the kids call them/)).toHaveCount(0);
  await expect(page.getByTestId("role-grownup").getByLabel(/What the kids call them/)).toBeVisible();
  // Each role's fields line up in two columns even where "What the kids call them (optional)" wraps onto two lines
  // (the roles sit side by side from 768 px), and stack one per row on a phone.
  const grownupFields = page.getByTestId("role-grownup").locator("fieldset");
  for (const width of [768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFieldsAligned(grownupFields, { wraps: true });
  }
  await page.setViewportSize({ width: 375, height: 740 });
  await expectFieldsAligned(grownupFields, { stacked: true });
  await expectFieldsAligned(page.getByTestId("role-hero").locator("fieldset"), { stacked: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await castKiteDay(
    page,
    { name: child, pronouns: "she/her", age: "Young child" },
    { name: grownup, title: "Grandpa", pronouns: "they/them", age: "Older adult" },
  );
  // The story's pages show its own characters (D56): a plate and one stock figure per appearance, 8 images.
  await expect(page.getByTestId("pages-heading")).toHaveText("The pages with Mia and Joe");
  const preview = page.getByRole("region", { name: "Pages" }).getByTestId("book-page");
  await expect(preview.nth(2)).toContainText("“Same time tomorrow?” asked Grandpa. Mia nodded, all smiles.");
  await imagesLoaded(page);
  await expect.poll(() => preview.locator("img").count()).toBe(8);
  await makeBook(page).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  await markShownBookDrawn(page);

  const allPages = page.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(allPages).toHaveCount(3);
  await expect(allPages.nth(2)).toContainText(`“Same time tomorrow?” asked Grandpa. ${child} nodded, all smiles.`);
  await imagesLoaded(page);
  // Until the book's figures are drawn from its character sheets, its pages show the stock figures.
  expect((await pageSources(page)).flat()).toHaveLength(8);

  // Changing pages from the strip under the page keeps the window where it is and the strip where it was: the router
  // used to scroll to the top, and the strip used to sit below the text editor, which grows and shrinks with each
  // page's paragraphs (page 1 has a title and a paragraph, page 2 one paragraph). Below 1024 px the text editor
  // stacks under the page, where that moved the strip.
  await page.setViewportSize({ width: 800, height: 900 });
  const thumbnails = page.getByRole("region", { name: "All pages" });
  // Scrolled down to the strip, with the book's steps above it.
  await thumbnails.evaluate((strip) => strip.scrollIntoView({ block: "end" }));
  const position = () =>
    thumbnails.evaluate((strip) => ({ scrollY: window.scrollY, top: strip.getBoundingClientRect().top }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const stripAt = await position();
  await thumbnails.getByRole("button", { name: "Page 2" }).click();
  await expect(thumbnails.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText(/^Page 2 of 3/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Text block/ })).toHaveCount(1);
  expect(await position()).toEqual(stripAt);
  await thumbnails.getByRole("button", { name: "Page 1" }).click();
  await expect(page.getByRole("textbox", { name: /^Text block/ })).toHaveCount(2);
  expect(await position()).toEqual(stripAt);
  // Previous and Next sit above the page; they step through the book and stop at its ends.
  await expect(page.getByRole("button", { name: "← Previous" })).toBeDisabled();
  await page.getByRole("button", { name: "Next →" }).click();
  await expect(thumbnails.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "← Previous" }).click();
  await expect(thumbnails.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await page.setViewportSize({ width: 1280, height: 720 });

  // Edit page 1's paragraph: the page shows the draft as it will print, then the saved text after a reload. A verb
  // after a pronoun must suit every pronoun the role may get, so "{{hero.they}} runs" is refused with the token to use.
  const editor = page.getByTestId("editor-page");
  const block = page.getByRole("textbox", { name: "Text block 2" });
  await block.fill("{{hero.name}} carried {{hero.their}} kite, and {{hero.they}} runs up the hill.");
  await page.getByRole("button", { name: "Save text block 2" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "{{hero.they}} {{hero:runs|run}}" })).toBeVisible();
  await block.fill("{{hero.name}} carried {{hero.their}} kite, and {{hero.they}} {{hero:runs|run}} up the hill.");
  await expect(editor).toContainText(`${child} carried her kite, and she runs up the hill.`);
  // The editor shows the page at print size: 8.5 in trim + 2 × 0.125 in bleed = 840 CSS px before scaling.
  expect(await editor.getByTestId("book-page").evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(840);
  await page.getByRole("button", { name: "Save text block 2" }).click();
  await expect(page.getByText("Paragraph 2 · edited")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("editor-page")).toContainText(`${child} carried her kite, and she runs up the hill.`);
  await imagesLoaded(page);
  await evidence(page, "book-editor");

  // On a 320 px phone every preview shrinks to fit, as a whole square page (still 840 px laid out inside), and none
  // overlaps another or makes the page scroll sideways. Fixed scales once put the thumbnails on top of each other.
  // The page strip scrolls sideways within itself, so its thumbnails may lie past the screen's edge; the strip doesn't.
  await page.setViewportSize({ width: 320, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  const boxes = await page.getByTestId("book-page").evaluateAll((sheets) =>
    sheets.map((sheet) => {
      const box = sheet.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        layoutWidth: (sheet as HTMLElement).offsetWidth,
        inStrip: !!sheet.closest('[aria-label="All pages"]'),
      };
    }),
  );
  expect(boxes).toHaveLength(4);
  for (const [i, box] of boxes.entries()) {
    expect(box.layoutWidth).toBe(840);
    if (!box.inStrip) expect(box.right).toBeLessThanOrEqual(320);
    expect(box.right - box.left).toBeCloseTo(box.bottom - box.top, 0);
    for (const other of boxes.slice(i + 1)) {
      const overlaps =
        Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
        Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1;
      expect(overlaps).toBe(false);
    }
  }
  expect(
    await page.getByRole("region", { name: "All pages" }).evaluate((strip) => strip.getBoundingClientRect().right),
  ).toBeLessThanOrEqual(320);
  await evidence(page, "book-editor-320");
  await page.setViewportSize({ width: 1280, height: 720 });

  // A PDF proof of this book: its cast and text as they are now, rendered by the worker (D27).
  const proofs = page.getByRole("region", { name: "PDF proofs" });
  await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
  const proof = proofs.getByTestId("proof").first();
  await expect(proof).toContainText(`${child} & ${grownup}`);
  await expect(proof).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proof.getByRole("link", { name: /Download PDF \(3 pages/ })).toBeVisible();
  const pdfHref = await proof.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  const pdf = await page.request.get(pdfHref!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  if (process.env.E2E_SCREENSHOTS)
    (await import("node:fs")).writeFileSync(`${process.env.E2E_SCREENSHOTS}/book-proof.pdf`, await pdf.body());

  // The grown-up's Change form keeps their title; a title stored for a child before the rule is neither shown, asked
  // for, nor kept when the child is saved.
  const bookId = new URL(page.url()).pathname.split("/").pop()!;
  const sql = async (query: string) => {
    const { Database, makeServerRuntime } = await import("@lifestory/core");
    const runtime = makeServerRuntime();
    try {
      return await runtime.runPromise(
        Database.use(({ pool }) => Effect.promise(() => pool.query(query, [bookId]))).pipe(
          Effect.map((result) => result.rows),
        ) as Effect.Effect<Array<Record<string, unknown>>>,
      );
    } finally {
      await runtime.dispose();
    }
  };
  await sql("update book_cast set title = 'Bubs' where book_id = $1 and slot_id = 'hero'");
  await page.reload();
  const grownupRole = page.getByTestId("role-grownup");
  await expect(grownupRole).toContainText(`${grownup} · Grandpa · they/them · older adult`);
  await grownupRole.getByRole("button", { name: "Change" }).click();
  await expect(grownupRole.getByLabel(/What the kids call them/)).toHaveValue("Grandpa");
  await grownupRole.getByRole("button", { name: "Cancel" }).click();

  // Changing who plays a role renames them on every page, and the role still offers only its own ages.
  const hero = page.getByTestId("role-hero");
  await expect(hero).toContainText(`${child} · she/her · young child`);
  await expect(hero).not.toContainText("Bubs");
  await hero.getByRole("button", { name: "Change" }).click();
  await expect(hero.getByLabel(/What the kids call them/)).toHaveCount(0);
  await expect(hero.getByLabel("Age").locator("option")).toHaveText(["Young child", "Older child"]);
  await hero.getByLabel("Name").fill(`Bo ${id}`);
  await hero.getByLabel("Pronouns").selectOption("they/them");
  await hero.getByLabel("Age").selectOption({ label: "Older child" });
  await hero.getByRole("button", { name: "Save" }).click();
  await expect(hero).toContainText(`Bo ${id} · they/them · older child`);
  expect(await sql("select slot_id, title from book_cast where book_id = $1 order by slot_id")).toEqual([
    { slot_id: "grownup", title: "Grandpa" },
    { slot_id: "hero", title: null },
  ]);
  await page.reload();
  await expect(allPages.nth(2)).toContainText(`“Same time tomorrow?” asked Grandpa. Bo ${id} nodded, all smiles.`);
  await expect(page.getByTestId("editor-page")).toContainText(`Bo ${id} carried their kite, and they run up the hill.`);
});

test("a viewer reads the family's books but can't change them", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const id = unique();
  const child = `Kit ${id}`;
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await page.goto("/stories/the-kite-day");
  await castKiteDay(
    page,
    { name: child, pronouns: "he/him", age: "Older child" },
    { name: `Lee ${id}`, pronouns: "she/her", age: "Adult" },
  );
  await makeBook(page).click();
  await expect(page).toHaveURL(/\/books\/book_/);
  const bookId = await markShownBookDrawn(page);
  const bookUrl = new URL(page.url()).pathname;
  // A drawn book without sheets (one made before photo books) shows none; with them, each role shows its own.
  await expect(page.getByRole("button", { name: /character sheet/ })).toHaveCount(0);
  const sheets = await giveSheets(bookId, ["hero", "grownup"]);
  await page.reload();
  const heroSheet = page.getByTestId("role-hero").getByRole("button", { name: `${child}'s character sheet` });
  await expect(heroSheet).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("img", { name: `${child}'s character sheet` })).toHaveCount(0);
  await heroSheet.click();
  const shown = page.getByTestId("role-hero").getByRole("img", { name: `${child}'s character sheet` });
  await expect(shown).toHaveAttribute("src", `/api/files/${sheets.hero}`);
  await expect(page.getByTestId("role-grownup").getByRole("button", { name: /character sheet/ })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  // Sheets drawn before the expressions show alone.
  await expect(page.getByRole("img", { name: /in six expressions/ })).toHaveCount(0);
  await imagesLoaded(page);
  await evidence(page, "book-sheet-open");
  // With the expressions drawn with the hero's sheet, they show under it; the grown-up's sheet still shows alone.
  Object.assign(sheets, await giveSheets(bookId, ["hero", "grownup"], ["hero"]));
  await page.reload();
  await heroSheet.click();
  await expect(page.getByTestId("role-hero").getByRole("img", { name: `${child} in six expressions` })).toHaveAttribute(
    "src",
    `/api/files/${sheets["hero:expressions"]}`,
  );
  await page
    .getByTestId("role-grownup")
    .getByRole("button", { name: /character sheet/ })
    .click();
  await expect(page.getByTestId("role-grownup").getByRole("img", { name: /character sheet/ })).toBeVisible();
  await expect(page.getByTestId("role-grownup").getByRole("img", { name: /in six expressions/ })).toHaveCount(0);
  await imagesLoaded(page);
  await evidence(page, "book-sheet-expressions-open");

  const viewer = await browser.newPage();
  await viewer.goto(`/__dev/log-me-in/grandparent@lifestory.dev?returnTo=${bookUrl}`);
  await expect(viewer.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(3);
  await expect(viewer.getByText("you're a viewer")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Save text/ })).toHaveCount(0);
  await expect(viewer.getByRole("textbox", { name: "Text block 1" })).toHaveAttribute("readonly", "");
  await expect(viewer.getByTestId("role-hero")).toContainText(child);
  await expect(viewer.getByTestId("role-hero").getByRole("button", { name: "Change" })).toHaveCount(0);
  // The viewer sees the sheets too; someone outside the family can't load them.
  await viewer.getByRole("button", { name: `${child}'s character sheet` }).click();
  await expect(viewer.getByRole("img", { name: `${child}'s character sheet` })).toBeVisible();
  await expect(viewer.getByRole("img", { name: `${child} in six expressions` })).toBeVisible();
  for (const key of [sheets.hero, sheets["hero:expressions"]])
    expect((await viewer.request.get(`/api/files/${key}`)).status()).toBe(200);
  const outsider = await browser.newPage();
  await outsider.goto(`/__dev/log-me-in/outsider-${id}@lifestory.dev?returnTo=/`);
  for (const key of [sheets.hero, sheets["hero:expressions"]])
    expect((await outsider.request.get(`/api/files/${key}`)).status()).toBe(404);
  await outsider.close();
  // The viewer previews the story but can't make or delete books.
  await viewer.goto("/stories/the-kite-day");
  await expect(viewer.getByTestId("story-books")).toContainText(child);
  await expect(makeBook(viewer)).toHaveCount(0);
  await viewer.goto(bookUrl);
  await expect(viewer.getByRole("button", { name: "Delete this book" })).toHaveCount(0);
  await viewer.goto("/books");
  await expect(viewer.getByTestId("books")).toContainText(child);
  await expect(viewer.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await viewer.close();

  // The story page lists the book; the parent deletes it from "Our books" after confirming, and it's gone everywhere.
  await page.goto("/stories/the-kite-day");
  await expect(page.getByTestId("story-books").getByRole("link", { name: new RegExp(child) })).toHaveAttribute(
    "href",
    bookUrl,
  );
  await page.goto("/books");
  const remove = page.getByRole("button", { name: new RegExp(`^Delete The Kite Day with .*${child}`) });
  const cancel = page.waitForEvent("dialog").then((dialog) => dialog.dismiss());
  await remove.click();
  await cancel;
  await expect(remove).toBeVisible();
  const confirm = page.waitForEvent("dialog").then((dialog) => dialog.accept());
  await remove.click();
  await confirm;
  await expect(remove).toHaveCount(0);
  await page.goto(bookUrl);
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(page.getByRole("region", { name: "All pages" })).toHaveCount(0);
});

test("a family with a book of the story is sent to it instead of silently making another, and copies are made only on purpose", async ({
  browser,
}) => {
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
    const people = [
      { name: child, pronouns: "she/her", age: "Young child" },
      { name: grownup, pronouns: "he/him", age: "Adult" },
    ] as const;
    await page.goto("/stories/the-kite-day");
    await castKiteDay(page, ...people);
    await expect(page.getByTestId("story-books")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make the book" })).toBeEnabled();
    const storyUrl = page.url();

    // A second tab still shows the page from before the book existed.
    const stale = await context.newPage();
    await stale.goto(storyUrl);
    await castKiteDay(stale, ...people);
    await expect(stale.getByRole("button", { name: "Make the book" })).toBeEnabled();

    await page.getByRole("button", { name: "Make the book" }).click();
    await expect(page).toHaveURL(/\/books\/book_/);
    const bookPath = new URL(page.url()).pathname;
    await markDrawn(bookPath.split("/").at(-1)!);

    // The stale tab's "Make the book" makes nothing: it says why and lists the book that exists now.
    await stale.getByRole("button", { name: "Make the book" }).click();
    await expect(stale.getByRole("alert")).toHaveText(
      "Your family already has a book of The Kite Day, so no new one was made.",
    );
    await expect(stale.getByTestId("story-books")).toContainText("Your family already has a book of this story");
    await expect(stale.getByRole("link", { name: "Open our book" })).toHaveAttribute("href", bookPath);
    await expect(stale.getByRole("button", { name: "Make the book" })).toHaveCount(0);
    await stale.close();

    // Home sends the family to that book too: the story's card opens it instead of offering another (D48).
    await page.goto("/");
    const storyCard = page.getByTestId("stories").getByRole("listitem").filter({ hasText: "The Kite Day" });
    await expect(storyCard.getByRole("link", { name: "Open our book" })).toHaveAttribute("href", bookPath);

    // Back on the story page, the book is listed and "Open our book" opens it.
    await page.goto(storyUrl);
    await expect(page.getByTestId("story-books")).toContainText(`The Kite Day with ${grownup}, ${child}`);
    await evidence(page, "story-has-book");
    await page.getByRole("link", { name: "Open our book" }).click();
    await expect(page).toHaveURL(new RegExp(`${bookPath}$`));
    await expect(page.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(3);

    // Two requests at once that both saw only that book make one more copy, not two. Imported here (AGENTS.md,
    // "Orb size").
    const { createBook, Database, makeServerRuntime } = await import("@lifestory/core");
    const runtime = makeServerRuntime();
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
    const cast = {
      hero: { name: child, title: null, pronouns: "she/her", age: "young-child" },
      grownup: { name: grownup, title: null, pronouns: "he/him", age: "adult" },
    } as const;
    const bookId = bookPath.split("/").at(-1)!;
    const attempts = await Promise.all(
      [0, 1].map(() =>
        runtime.runPromise(
          Effect.exit(createBook(owner!.userId, owner!.familyId, { slug: "the-kite-day", cast, existing: [bookId] })),
        ),
      ),
    );
    // The first makes a draft; the second, under the same lock, reopens that draft (D57) instead of a second copy.
    const made = attempts.filter(Exit.isSuccess).map((exit) => exit.value.id);
    expect(made).toHaveLength(2);
    expect(new Set(made).size).toBe(1);
    await runtime.dispose();
    await markDrawn(made[0]!);

    // With several books the page doesn't pick one: each is listed, and another copy is made only on purpose.
    await page.goto(storyUrl);
    await expect(page.getByTestId("story-books")).toContainText("Your family already has 2 books of this story");
    await expect(page.getByTestId("story-books").getByRole("link")).toHaveCount(2);
    await expect(page.getByRole("link", { name: "Open our book" })).toHaveCount(0);
    // People from the family's books are offered, so another copy needn't be typed again.
    const pick = page.getByLabel("The child: someone from your other books");
    await expect(pick.locator("option")).toHaveText(["Choose…", child]);
    await pick.selectOption({ label: child });
    await expect(page.getByTestId("role-hero").getByLabel("Name")).toHaveValue(child);
    await page.getByLabel("A grown-up: someone from your other books").selectOption({ label: grownup });
    await page.getByRole("button", { name: "Make another copy" }).click();
    await expect(page).toHaveURL(/\/books\/book_/);
    const newest = new URL(page.url()).pathname;
    await markDrawn(newest.split("/").at(-1)!);
    expect(newest).not.toBe(bookPath);
    // Home picks up the newest book, and the story's card leaves the choice to the story page.
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Pick up where you left off" }).getByRole("link").first(),
    ).toHaveAttribute("href", newest);
    await expect(storyCard.getByRole("link", { name: "Our 3 books" })).toHaveAttribute("href", "/stories/the-kite-day");
    await expect(storyCard.getByRole("link", { name: "Open our book" })).toHaveCount(0);
    await page.goto("/books");
    await expect(page.getByTestId("books").getByRole("button", { name: /^Delete The Kite Day/ })).toHaveCount(3);
  } finally {
    await context.close();
  }
});

test("each book in Our books shows its cover: the drawn cover page, else the cover from the sheets, else stock figures", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const id = unique();
  const child = `Bo ${id}`;
  await page.goto(`/__dev/log-me-in/cover-${id}@lifestory.dev?returnTo=/`);
  await page.goto("/stories/the-kite-day");
  await castKiteDay(
    page,
    { name: child, pronouns: "she/her", age: "Older child" },
    { name: `Jo ${id}`, pronouns: "he/him", age: "Adult" },
  );
  await makeBook(page).click();
  const bookId = await markShownBookDrawn(page);

  const { Database, ObjectStorage, makeServerRuntime } = await import("@lifestory/core");
  /** Stores an SVG per key under the book's family and runs `query`, as the photo-book tasks would leave things. */
  const store = async (keys: ReadonlyArray<string>, query: string, params: ReadonlyArray<unknown>) => {
    const runtime = makeServerRuntime();
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const { pool } = yield* Database;
          const storage = yield* ObjectStorage;
          for (const key of keys)
            yield* storage.put(
              key,
              new TextEncoder().encode(
                `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#c33"/></svg>`,
              ),
              "image/svg+xml",
            );
          yield* Effect.promise(() => pool.query(query, [...params]));
        }) as Effect.Effect<void, never, ServerServices>,
      );
    } finally {
      await runtime.dispose();
    }
  };
  const familyId = await (async () => {
    const runtime = makeServerRuntime();
    try {
      return await runtime.runPromise(
        Database.use(({ pool }) =>
          Effect.promise(() =>
            pool.query("select family_id from book where id = $1", [bookId]).then((r) => r.rows[0].family_id as string),
          ),
        ) as Effect.Effect<string, never, ServerServices>,
      );
    } finally {
      await runtime.dispose();
    }
  })();
  const prefix = `families/${familyId}/books/${bookId}`;

  const cover = page.getByTestId("books").getByRole("listitem").filter({ hasText: child }).getByTestId("book-cover");
  const sources = () => cover.locator("img").evaluateAll((imgs) => imgs.map((img) => img.getAttribute("src")));
  const loaded = () =>
    expect
      .poll(() =>
        cover.locator("img").evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);

  // Before anything is drawn: the story version's cover page (p01, with both roles) in stock figures.
  await page.goto("/books");
  const [plate, ...stock] = await sources();
  expect(plate).toMatch(/^\/api\/files\/stories\/[^/]+\/v\d+\/pages\/p01\/.+/);
  const files = plate!.slice(0, plate!.lastIndexOf("/"));
  expect(stock).toEqual([`${files}/hero/stock.svg`, `${files}/grownup/stock.svg`]);
  await loaded();
  await evidence(page, "books-cover-stock");

  // With the cover drawn from the sheets: its figures over the plate.
  const likeness = [`${prefix}/likeness/cover/r0/0.svg`, `${prefix}/likeness/cover/r0/1.svg`];
  await store(likeness, "update book set cover = $2 where id = $1", [bookId, JSON.stringify(likeness)]);
  await page.reload();
  expect(await sources()).toEqual([plate, ...likeness.map((key) => `/api/files/${key}`)]);
  await loaded();

  // With the cover page drawn for the book: the version the parent chose, not another.
  const drawn = (version: number) => [0, 1].map((figure) => `${prefix}/pages/p01/v${version}/${figure}.svg`);
  await store(
    [...drawn(1), ...drawn(2)],
    `with drawn_page as (
       insert into book_page (book_id, page_id, latest_version, chosen_version, ready) values ($1, 'p01', 2, 1, true)
     )
     insert into book_page_art (book_id, page_id, version, figure, slot_id, object_key, iou, rescaled, clipped_share)
       select $1, 'p01', v, f, case f when 0 then 'hero' else 'grownup' end,
              $2 || '/pages/p01/v' || v || '/' || f || '.svg', 1, false, 0
       from generate_series(1, 2) v, generate_series(0, 1) f`,
    [bookId, prefix],
  );
  await page.reload();
  expect(await sources()).toEqual([plate, ...drawn(1).map((key) => `/api/files/${key}`)]);
  await loaded();
  await evidence(page, "books-cover");

  // The page's shape beside the title, on a desktop and a 320 px phone, with Delete still on the row.
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const box = (await cover.boundingBox())!;
    expect(box.width).toBeGreaterThan(50);
    expect(box.height).toBeCloseTo(box.width, 0);
    await expect(
      page.getByRole("button", { name: new RegExp(`^Delete The Kite Day with .*${child}`) }),
    ).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await evidence(page, `books-cover-${width}`);
  }
  // The picture opens the book like its title, without a second link for screen readers.
  await expect(page.getByTestId("books").getByRole("link", { name: "The Kite Day" })).toHaveCount(1);
  await cover.click();
  await expect(page).toHaveURL(new RegExp(`/books/${bookId}$`));

  // Someone outside the family neither sees the book nor loads its cover.
  const outsider = await browser.newPage();
  await outsider.goto(`/__dev/log-me-in/outsider-${id}@lifestory.dev?returnTo=/books`);
  await expect(outsider.getByTestId("book-cover")).toHaveCount(0);
  for (const key of [likeness[0]!, drawn(1)[0]!])
    expect((await outsider.request.get(`/api/files/${key}`)).status()).toBe(404);
  await outsider.close();
});
