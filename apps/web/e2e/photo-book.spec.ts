import type { ServerServices } from "@lifestory/core";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { Effect } from "effect";

// A photo book end to end on the fakes (D56, D57, D58): consent, a photo per role with one refused by the check, the
// sheets and two change rounds, the order (photos gone), three page changes kept or used, a proof, review and the
// operator's approval; a second book opted in to photo review, whose photos the operator sees and approval deletes;
// and the sweep of a draft left for a day.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A small real PNG: the browser decodes and re-encodes it before upload, and the fake check passes any face. */
const PHOTO = Buffer.from(
  "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",
  "base64",
);
const photo = (name: string) => ({ name, mimeType: "image/png", buffer: PHOTO });

const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS)
    await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};

/** Runs an Effect against the app's services; @lifestory/core is imported here (AGENTS.md, "Orb size"). */
const withCore = async <A>(
  f: (core: typeof import("@lifestory/core")) => Effect.Effect<A, unknown, ServerServices>,
) => {
  const core = await import("@lifestory/core");
  const runtime = core.makeServerRuntime();
  try {
    return await runtime.runPromise(f(core));
  } finally {
    await runtime.dispose();
  }
};
const sql = <R>(text: string, params: ReadonlyArray<unknown> = []) =>
  withCore(({ Database }) =>
    Database.use(({ pool }) => Effect.promise(() => pool.query(text, [...params]))).pipe(
      Effect.map((result) => result.rows as Array<R>),
    ),
  );
const photosOf = async (bookId: string) => {
  const [book] = await sql<{ family_id: string }>("select family_id from book where id = $1", [bookId]);
  return withCore(({ ObjectStorage }) =>
    ObjectStorage.use((storage) => storage.list(`families/${book!.family_id}/books/${bookId}/photos/`)),
  ).then((objects) => objects.length);
};

/** From the story page: who plays each role, then the draft book. Returns the book's ID. */
const startBook = async (page: Page, child: string, grownup: string) => {
  await page.goto("/stories/the-kite-day");
  for (const [slotId, name, age] of [
    ["hero", child, "Young child"],
    ["grownup", grownup, "Adult"],
  ] as const) {
    const role = page.getByTestId(`role-${slotId}`);
    await role.getByLabel("Name").fill(name);
    await role.getByLabel("Age").selectOption({ label: age });
  }
  await page.getByRole("button", { name: /^(Make the book|Make another copy)$/ }).click();
  await page.waitForURL(/\/books\/book_/);
  return new URL(page.url()).pathname.split("/").pop()!;
};

/** Consent, then a passing photo per role; waits for the sheets and the cover. */
const addPhotos = async (page: Page, child: string, grownup: string, shareWithReview: boolean) => {
  await page.getByLabel("I'm 18 or older.").check();
  await page.getByLabel(/^I have the right to use each photo/).check();
  await page.getByLabel(/^I understand how photos are used/).check();
  if (shareWithReview) await page.getByLabel(/^Optional: Lifestory's team may see the photos/).check();
  await page.getByRole("button", { name: "Agree and add photos" }).click();
  await page.getByLabel(`Photo of ${child}`).setInputFiles(photo("child.png"));
  await page.getByLabel(`Photo of ${grownup}`).setInputFiles(photo("grownup.png"));
  await expect(page.getByTestId("sheet-hero")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("sheet-grownup")).toBeVisible();
  await expect(page.getByTestId("cover")).toBeVisible();
};

const makeAndWait = async (page: Page) => {
  await page.getByRole("button", { name: "Make my book" }).click();
  await expect(page.getByTestId("book-step").first()).toContainText("Read your book", { timeout: 90_000 });
};

const signedIn = async (browser: Browser, email: string, path: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/__dev/log-me-in/${email}?returnTo=${encodeURIComponent(path)}`);
  return { context, page };
};

test("a parent puts the family into a book from photos, changes pages, and the operator reviews it", async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const id = unique();
  const [child, grownup] = [`Maya ${id}`, `Sam ${id}`];
  const parent = await signedIn(browser, `photos-${id}@lifestory.dev`, "/");
  const operator = await signedIn(browser, "operator@lifestory.dev", "/admin");
  try {
    const { page } = parent;
    const bookId = await startBook(page, child, grownup);
    // A draft is hidden from the family's books until it's ordered (D57).
    expect((await sql("select status from book where id = $1", [bookId]))[0]).toEqual({ status: "draft" });

    // The check refuses a photo with two people near the camera, and says why.
    await page.getByLabel("I'm 18 or older.").check();
    await page.getByLabel(/^I have the right to use each photo/).check();
    await page.getByLabel(/^I understand how photos are used/).check();
    await page.getByRole("button", { name: "Agree and add photos" }).click();
    await page.getByLabel(`Photo of ${grownup}`).setInputFiles(photo("sam-two-faces.png"));
    await expect(page.getByTestId("photo-status-grownup")).toHaveText("We can't use this photo.", { timeout: 30_000 });
    await expect(page.getByTestId("photo-grownup")).toContainText("more than one person close to the camera");
    expect(await photosOf(bookId)).toBe(0);
    await evidence(page, "photo-refused");

    await page.getByLabel(`Photo of ${child}`).setInputFiles(photo("child.png"));
    await page.getByLabel(`Photo of ${grownup}`).setInputFiles(photo("grownup.png"));
    await expect(page.getByTestId("sheet-hero")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("cover")).toBeVisible();
    expect(await photosOf(bookId)).toBe(2);
    await evidence(page, "photo-preview");

    // Two rounds of changes, each a note that edits that person's current sheet (D56), then no more.
    for (const [round, left] of [
      [1, "2 rounds left"],
      [2, "1 round left"],
    ] as const) {
      await page.getByLabel(`What to change about ${child}`).fill(`round ${round}: curlier hair`);
      await page.getByRole("button", { name: `Ask for these changes (${left})` }).click();
      // Drawn when the book reports the round ready; the button alone may still be the page from before the click.
      await expect
        .poll(() => sql("select likeness_round, likeness_status from book where id = $1", [bookId]), {
          timeout: 60_000,
        })
        .toEqual([{ likeness_round: round, likeness_status: "ready" }]);
      await page.reload();
    }
    await expect(page.getByLabel(`What to change about ${child}`)).toHaveCount(0);
    const sheets = await sql<{ slot_id: string; sheet_key: string }>(
      "select slot_id, sheet_key from book_likeness where book_id = $1 order by slot_id",
      [bookId],
    );
    expect(sheets.find((row) => row.slot_id === "hero")!.sheet_key).toMatch(/sheet-r2\.png$/);
    expect(sheets.find((row) => row.slot_id === "grownup")!.sheet_key).not.toMatch(/sheet-r/);

    // Until the order, the sheets show only in the preview step, not with the cast.
    await expect(page.getByTestId("role-hero").getByRole("button", { name: /character sheet/ })).toHaveCount(0);

    // The order draws every page and deletes the photos (no photo review opted in).
    await makeAndWait(page);
    expect(await photosOf(bookId)).toBe(0);
    // The cast then shows each role's approved sheet: the hero's from the last round, the grown-up's first sheet.
    for (const [slotId, name] of [
      ["hero", child],
      ["grownup", grownup],
    ] as const) {
      await page
        .getByTestId(`role-${slotId}`)
        .getByRole("button", { name: `${name}'s character sheet` })
        .click();
      const sheet = page.getByRole("img", { name: `${name}'s character sheet` });
      await expect(sheet).toHaveAttribute(
        "src",
        `/api/files/${sheets.find((row) => row.slot_id === slotId)!.sheet_key}`,
      );
      expect((await page.request.get((await sheet.getAttribute("src"))!)).status()).toBe(200);
    }
    await evidence(page, "photo-cast-sheets");
    const art = await sql<{ n: number }>("select count(*)::int as n from book_page_art where book_id = $1", [bookId]);
    expect(art[0]!.n).toBe(5);

    // Three page changes: use the new drawing on two, keep the original on one; then no fourth.
    const strip = page.getByRole("region", { name: "All pages" });
    for (const n of [1, 2, 3]) {
      await strip.getByRole("button", { name: `Page ${n}` }).click();
      await page.getByLabel("What to change on this page").fill(`page ${n}: make her smile`);
      await page.getByRole("button", { name: "Redraw this page" }).click();
      const versions = page.getByTestId("page-versions");
      await expect(versions).toBeVisible({ timeout: 60_000 });
      if (n !== 2) await versions.getByRole("button", { name: "Use the new one" }).click();
      await expect(versions.getByRole("button", { name: "Chosen" })).toBeVisible();
    }
    await expect(page.getByLabel("What to change on this page")).toHaveCount(0);
    expect(
      await sql("select page_id, chosen_version from book_page where book_id = $1 order by page_id", [bookId]),
    ).toEqual([
      { page_id: "p01", chosen_version: 2 },
      { page_id: "p02", chosen_version: 1 },
      { page_id: "p03", chosen_version: 2 },
    ]);
    await evidence(page, "photo-page-changes");

    // A proof, approved, then the book goes to our review.
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByRole("alert")).toContainText("Approve a proof first");
    const proofs = page.getByRole("region", { name: "PDF proofs" });
    await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
    const proof = proofs.getByTestId("proof").first();
    await expect(proof).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
    await proof.getByRole("button", { name: "Approve for print" }).click();
    await expect(proof).toHaveAttribute("data-approved", "true");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("book-step")).toContainText("With our team");

    // The operator sees the sheets and pages, never the photos of a book not opted in, and approves it.
    await operator.page.goto("/admin");
    await expect(operator.page.getByTestId("review-queue").getByRole("link", { name: "The Kite Day" })).not.toHaveCount(
      0,
    );
    await operator.page.goto(`/review/${bookId}`);
    await expect(operator.page.getByTestId("review-status")).toContainText("in review · photos not shared");
    await expect(operator.page.getByTestId(/^review-photo-/)).toHaveCount(0);
    await expect(operator.page.getByTestId("review-page-p01")).toContainText("version 2 of 2");
    await evidence(operator.page, "photo-review");
    await operator.page.getByRole("button", { name: "Approve for print" }).click();
    await expect(operator.page.getByTestId("review-status")).toContainText("approved");
    await page.reload();
    await expect(page.getByTestId("book-step")).toContainText("Approved for print");
    await page.getByRole("button", { name: `${child}'s character sheet` }).click();
    await expect(page.getByRole("img", { name: `${child}'s character sheet` })).toBeVisible();

    // A second book, opted in to photo review: the order keeps the photos, the operator sees them, approval deletes them.
    const second = await startBook(page, child, grownup);
    await addPhotos(page, child, grownup, true);
    await makeAndWait(page);
    expect(await photosOf(second)).toBe(2);
    // The proof and sending for review are covered above; here the book goes straight to review.
    await sql("update book set status = 'in_review' where id = $1", [second]);
    await operator.page.goto(`/review/${second}`);
    await expect(operator.page.getByTestId("review-status")).toContainText("photos for this review");
    const shown = operator.page.getByTestId("review-photo-hero");
    await expect(shown).toBeVisible();
    const src = (await shown.getAttribute("src"))!;
    expect((await operator.page.request.get(src)).status()).toBe(200);
    // The parent's own photo link isn't open to another family.
    const outsider = await signedIn(browser, "grandparent@lifestory.dev", "/");
    expect((await outsider.page.request.get(src)).status()).toBe(404);
    await outsider.context.close();
    await operator.page.getByRole("button", { name: "Approve for print" }).click();
    await expect(operator.page.getByTestId("review-status")).toContainText("approved");
    await expect.poll(() => photosOf(second), { timeout: 30_000 }).toBe(0);
    expect((await operator.page.request.get(src)).status()).toBe(404);

    // A draft left for a day goes whole with the sweep: its row and its photos.
    const third = await startBook(page, child, grownup);
    const [thirdRow] = await sql<{ family_id: string }>("select family_id from book where id = $1", [third]);
    const photoKey = `families/${thirdRow!.family_id}/books/${third}/photos/hero/up_left`;
    await withCore(({ ObjectStorage }) =>
      ObjectStorage.use((storage) => storage.put(photoKey, new Uint8Array(PHOTO), "image/png")),
    );
    await sql("update book set created_at = now() - interval '25 hours' where id = $1", [third]);
    const { taskId } = await withCore(({ Jobs, sweepStorage }) => Jobs.use((jobs) => jobs.spawn(sweepStorage, {})));
    await expect
      .poll(() => withCore(({ Jobs }) => Jobs.use((jobs) => jobs.status(taskId))).then((s) => s.state), {
        timeout: 60_000,
      })
      .toBe("completed");
    expect(await sql("select id from book where id = $1", [third])).toEqual([]);
    expect(await photosOf(second)).toBe(0);
    await expect(
      withCore(({ ObjectStorage }) => ObjectStorage.use((storage) => storage.get(photoKey))),
    ).rejects.toThrow();
  } finally {
    await parent.context.close();
    await operator.context.close();
  }
});
