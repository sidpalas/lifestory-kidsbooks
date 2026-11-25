import type { ServerServices } from "@lifestory/core";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { Effect } from "effect";

import { expectContained } from "./layout.ts";

// A photo book end to end on the fakes (D56, D57, D58): consent, a photo per role with one refused by the check, each
// person drawn when the parent asks, two notes that use the child's last drawings (then their photo can't change), the order (photos gone), three page changes kept or used, a proof, review and the
// operator's approval; a second book opted in to photo review, whose photos the operator sees and approval deletes;
// and the sweep of a draft left for a day.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** A small real PNG: the browser decodes and re-encodes it before upload, and the fake check passes any face. */
const PHOTO = Buffer.from(
  "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",
  "base64",
);
const photo = (name: string) => ({ name, mimeType: "image/png", buffer: PHOTO });

/** Drops files on an element the way a desktop browser does: dragenter, dragover, then drop with their DataTransfer. */
const dropFiles = async (page: Page, testId: string, names: ReadonlyArray<string>) => {
  const transfer = await page.evaluateHandle(
    ({ files, base64 }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      for (const name of files) data.items.add(new File([bytes], name, { type: "image/png" }));
      return data;
    },
    { files: names, base64: PHOTO.toString("base64") },
  );
  const target = page.getByTestId(testId);
  for (const type of ["dragenter", "dragover", "drop"]) await target.dispatchEvent(type, { dataTransfer: transfer });
};

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

/** Draws each person once their photo passes ("Draw {name}"), then waits for the sheets and the cover. */
const drawEveryone = async (page: Page, names: ReadonlyArray<string>) => {
  for (const name of names)
    await page.getByRole("button", { name: `Draw ${name} (3 drawings left)` }).click({ timeout: 30_000 });
  await expect(page.getByTestId("sheet-hero")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("sheet-grownup")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("cover")).toBeVisible({ timeout: 60_000 });
};

/** Consent, then a passing photo per role; draws everyone and waits for the sheets and the cover. */
const addPhotos = async (page: Page, child: string, grownup: string, shareWithReview: boolean) => {
  await page.getByLabel("I'm 18 or older.").check();
  await page.getByLabel(/^I have the right to use each photo/).check();
  await page.getByLabel(/^I understand how photos are used/).check();
  if (shareWithReview) await page.getByLabel(/^Optional: Lifestory's team may see the photos/).check();
  await page.getByRole("button", { name: "Agree and add photos" }).click();
  await page.getByLabel(`Photo of ${child}`).setInputFiles(photo("child.png"));
  await page.getByLabel(`Photo of ${grownup}`).setInputFiles(photo("grownup.png"));
  await drawEveryone(page, [child, grownup]);
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

    // A photo can be dropped on its person's card; dropping several uploads none, since each slot takes one photo.
    await dropFiles(page, "photo-hero", ["child.png", "child-2.png"]);
    await expect(page.getByTestId("photo-hero").getByRole("alert")).toHaveText(
      `That's 2 files. Drop one photo here: each slot takes one photo of ${child}.`,
    );
    await expect(page.getByTestId("photo-status-hero")).toHaveText("No photo yet.");
    await dropFiles(page, "photo-hero", ["child.png"]);
    await expect(page.getByTestId("photo-status-hero")).toHaveText(/^(Checking the photo…|This photo works\.)$/, {
      timeout: 30_000,
    });
    await expect(page.getByTestId("photo-hero").getByRole("alert")).toHaveCount(0);
    // Phones also get a button that opens the rear camera; its photo takes the same path.
    const camera = page.getByLabel(`Take ${grownup}'s photo with the camera`);
    await expect(camera).toHaveAttribute("capture", "environment");
    await camera.setInputFiles(photo("grownup.png"));
    // Nothing is drawn until the parent asks, one person at a time (D56).
    await expect(page.getByTestId("photo-status-grownup")).toHaveText("This photo works.", { timeout: 30_000 });
    expect(await sql("select likeness_status from book where id = $1", [bookId])).toEqual([
      { likeness_status: "waiting" },
    ]);
    await expect(page.getByRole("button", { name: `Draw ${grownup} (3 drawings left)` })).toBeVisible();

    // The look the photo showed (the fake reads short, wavy, brown hair), which the parent corrects before drawing;
    // the correction and the photo's reading both show, and the sheet is drawn from the correction (D56).
    const look = page.getByTestId("look-hero");
    const length = look.getByLabel(`${child}'s hair length`);
    await expect(length).toHaveValue("short");
    await expect(look).toContainText("From the photo");
    await length.selectOption({ label: "Long" });
    await expect(length).toHaveValue("long");
    await expect(look).toContainText("You set this");
    await expect(look).toContainText("The photo looked short.");

    // Optional extra photos, one per pose (D56): each slot is its own drop target and checks its photo, and one of
    // someone else is refused. The passing one goes to the sheet with the main photo, never to a page.
    const pose = page.getByTestId("pose-hero-expression");
    await dropFiles(page, "pose-hero-expression", ["other-person.png"]);
    await expect(page.getByTestId("pose-status-hero-expression")).toHaveText("We can't use this photo.", {
      timeout: 30_000,
    });
    await expect(pose).toContainText("different person from the first photo");
    await expect(page.getByTestId("photo-status-hero")).toHaveText("This photo works.");
    await page.getByLabel(`A different expression (${child})`).setInputFiles(photo("laughing.png"));
    await expect(page.getByTestId("pose-status-hero-expression")).toHaveText("This photo works.", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("pose-hero-hair")).not.toContainText("No photo yet");
    await expect(page.getByLabel(`Use the camera for ${child}, the side or back of their hair`)).toHaveAttribute(
      "capture",
      "environment",
    );
    await evidence(page, "photo-draw");
    await drawEveryone(page, [child, grownup]);
    const [first] = await sql<{ prompt: string }>(
      "select request->>'prompt' as prompt from generation where request->>'outputKey' like $1",
      [`%/books/${bookId}/likeness/hero/sheet-d1-%`],
    );
    expect(first!.prompt).toContain("Hair: long, wavy, brown hair. Eyes: brown. Skin tone: light.");
    const [heroSheet] = await sql<{ references: Array<string> }>(
      "select request->'references' as references from generation where request->>'outputKey' like $1",
      [`%/books/${bookId}/likeness/hero/sheet-d1-%`],
    );
    const [extra] = await sql<{ photo_key: string }>(
      "select photo_key from book_pose_photo where book_id = $1 and slot_id = 'hero' and pose = 'expression'",
      [bookId],
    );
    // The main photo, the extra photo, then the style reference.
    expect(heroSheet!.references).toHaveLength(3);
    expect(heroSheet!.references[1]).toBe(extra!.photo_key);
    expect(first!.prompt).toContain("The first 2 images are photos of the same person");
    // Each drawing also draws the person in six expressions, from the sheet just drawn and never the photo (D56).
    await expect(page.getByTestId("expressions-hero")).toBeVisible();
    const [expressions] = await sql<{ references: Array<string>; sheet: string }>(
      `select g.request->'references' as references, l.sheet_key as sheet from generation g, book_likeness l
       where g.request->>'outputKey' like $1 and l.book_id = $2 and l.slot_id = 'hero'`,
      [`%/books/${bookId}/likeness/hero/expressions-d1-%`, bookId],
    );
    expect(expressions!.references).toEqual([expressions!.sheet]);
    // Once drawn, the look is how they were drawn; a note changes it.
    await expect(page.getByTestId("look-hero").getByLabel(`${child}'s hair length`)).toBeDisabled();
    expect(await photosOf(bookId)).toBe(3); // two main photos and the passing extra one; the refused one is gone
    await evidence(page, "photo-preview");
    // On a phone each person's photo and sheet card fits its column: the buttons named after the person wrap instead
    // of widening the card off the screen.
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const card of await page.getByTestId(/^(photo-(hero|grownup)|pose-.+|sheet-card-.+)$/).all())
        await expectContained(card);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    // Two notes on the child, each using one of their drawings and editing their current sheet (D56); the
    // grown-up's sheet doesn't change. Then the child has no drawings left, and their photo can't change.
    const firstSheets = await sql<{ slot_id: string; sheet_key: string }>(
      "select slot_id, sheet_key from book_likeness where book_id = $1 order by slot_id",
      [bookId],
    );
    for (const [draw, left] of [
      [2, "2 drawings left"],
      [3, "1 drawing left"],
    ] as const) {
      await page.getByLabel(`What to change about ${child}`).fill(`drawing ${draw}: curlier hair`);
      await page.getByRole("button", { name: `Redraw ${child} with this note (${left})` }).click();
      await expect
        .poll(
          () =>
            sql(
              `select l.draws, l.drawing, b.likeness_status from book_likeness l join book b on b.id = l.book_id
               where l.book_id = $1 and l.slot_id = 'hero'`,
              [bookId],
            ),
          { timeout: 60_000 },
        )
        .toEqual([{ draws: draw, drawing: false, likeness_status: "ready" }]);
      await page.reload();
    }
    await expect(page.getByLabel(`What to change about ${child}`)).toHaveCount(0);
    await expect(page.getByTestId("sheet-card-hero")).toContainText(`That was the last drawing of ${child}.`);
    await expect(page.getByLabel(`What to change about ${grownup}`)).toBeVisible();
    const sheets = await sql<{ slot_id: string; sheet_key: string; draws: number; notes: Array<{ round: number }> }>(
      "select slot_id, sheet_key, draws, notes from book_likeness where book_id = $1 order by slot_id",
      [bookId],
    );
    const before = (slotId: string) => firstSheets.find((row) => row.slot_id === slotId)!.sheet_key;
    const after = (slotId: string) => sheets.find((row) => row.slot_id === slotId)!;
    expect(after("hero").sheet_key).not.toBe(before("hero"));
    expect(after("hero").notes.map((note) => note.round)).toEqual([2, 3]);
    expect(after("grownup")).toMatchObject({ sheet_key: before("grownup"), draws: 1, notes: [] });
    await page.getByLabel(`Photo of ${child}`).setInputFiles(photo("child-again.png"));
    await expect(page.getByTestId("photo-hero").getByRole("alert")).toHaveText(
      `You've used all 3 drawings of ${child}, so their photo can't change.`,
    );

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
    await operator.page.setViewportSize({ width: 320, height: 720 });
    await expectContained(operator.page.getByRole("button", { name: "Approve for print" }).locator(".."));
    await operator.page.setViewportSize({ width: 1280, height: 720 });
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

test("an account's photo uploads are limited in bursts and in total, counting every photo it stored (D59)", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { photoUploadLimits: limits } = await import("@lifestory/core");
  const id = unique();
  const [child, grownup] = [`Ava ${id}`, `Ben ${id}`];
  const email = `limits-${id}@lifestory.dev`;
  const parent = await signedIn(browser, email, "/");
  try {
    const { page } = parent;
    const bookId = await startBook(page, child, grownup);
    await page.getByLabel("I'm 18 or older.").check();
    await page.getByLabel(/^I have the right to use each photo/).check();
    await page.getByLabel(/^I understand how photos are used/).check();
    await page.getByRole("button", { name: "Agree and add photos" }).click();
    await expect(page.getByLabel(`Photo of ${child}`)).toBeAttached();
    const [{ id: userId }] = (await sql<{ id: string }>('select id from "user" where email = $1', [email])) as [
      { id: string },
    ];
    const counted = async () =>
      Number((await sql<{ n: string }>("select count(*) as n from photo_upload where user_id = $1", [userId]))[0]!.n);
    const upload = (slotId: string, name: string, mimeType = "image/png") =>
      page.request.post(`/api/books/${bookId}/photos`, {
        headers: { "x-lifestory-upload": "1" },
        multipart: {
          file: { name, mimeType, buffer: PHOTO },
          slotId,
        },
      });

    // A request refused before anything is stored doesn't count.
    expect((await upload("hero", "child.gif", "image/gif")).status()).toBe(400);
    expect(await counted()).toBe(0);

    // A photo the check refuses was stored and checked, so it counts.
    const refused = (await (await upload("grownup", "ben-two-faces.png")).json()) as { uploadId: string };
    await expect
      .poll(() => sql("select check_status from book_likeness where upload_id = $1", [refused.uploadId]), {
        timeout: 30_000,
      })
      .toEqual([{ check_status: "refused" }]);
    expect(await sql("select id from photo_upload where id = $1", [refused.uploadId])).toEqual([
      { id: refused.uploadId },
    ]);

    // Five more than the burst at once, each replacing the last: exactly the burst is stored, the rest wait.
    const burst = await Promise.all(
      Array.from({ length: limits.burst.count + 4 }, (_, i) => upload("hero", `child-${i}.png`)),
    );
    const statuses = burst.map((response) => response.status());
    expect(statuses.filter((status) => status === 200)).toHaveLength(limits.burst.count - 1);
    expect(statuses.filter((status) => status === 429)).toHaveLength(5);
    const waiting = burst.find((response) => response.status() === 429)!;
    expect(Number(waiting.headers()["retry-after"])).toBeGreaterThan(0);
    expect(((await waiting.json()) as { error: string }).error).toMatch(
      new RegExp(`^You've added ${limits.burst.count} photos in the last 10 minutes\\. Try again in `),
    );
    expect(await counted()).toBe(limits.burst.count);

    // What the limit protects is the check (Sid): only stored uploads start `photo.check`, the only caller of
    // PhotoCheck's moderation and inspection. The 21st upload in the window is refused and starts nothing.
    const checks = async () =>
      (
        await sql<{ upload_id: string }>(
          "select params->>'uploadId' as upload_id from absurd.t_default where task_name = 'photo.check' and params->>'bookId' = $1",
          [bookId],
        )
      )
        .map((row) => row.upload_id)
        .toSorted();
    const stored = async () =>
      (await sql<{ id: string }>("select id from photo_upload where book_id = $1", [bookId]))
        .map((row) => row.id)
        .toSorted();
    expect(await checks()).toEqual(await stored());
    const next = await upload("hero", `child-${limits.burst.count + 1}.png`);
    expect(next.status()).toBe(429);
    expect(await checks()).toHaveLength(limits.burst.count);
    expect(await checks()).toEqual(await stored());

    // A day later the burst has passed; with one upload left of the allowance, three at once store one.
    await sql("update photo_upload set created_at = now() - interval '1 day' where user_id = $1", [userId]);
    await sql(
      `insert into photo_upload (id, user_id, book_id, created_at)
       select 'up_old_' || $1 || '_' || n, $1, $2, now() - interval '2 days' from generate_series(1, $3::int) n`,
      [userId, bookId, limits.allowance - limits.burst.count - 1],
    );
    const last = await Promise.all([1, 2, 3].map((i) => upload("hero", `last-${i}.png`)));
    expect(last.map((response) => response.status()).toSorted()).toEqual([200, 429, 429]);
    const capped = last.find((response) => response.status() === 429)!;
    expect(capped.headers()["retry-after"]).toBeUndefined();
    expect(((await capped.json()) as { error: string }).error).toMatch(
      new RegExp(`^You've used all ${limits.allowance} photo uploads this account has\\.`),
    );
    expect(await counted()).toBe(limits.allowance);

    // The parent sees why on the person's card.
    await page.getByLabel(`Photo of ${child}`).setInputFiles(photo("one-more.png"));
    await expect(page.getByTestId("photo-hero").getByRole("alert")).toContainText(
      `You've used all ${limits.allowance} photo uploads this account has.`,
    );
    await evidence(page, "upload-limit");

    // An order isn't paid for yet (D57), so placing one raises nothing; a book the operator approved does.
    const other = `book_limits_${id}`;
    await sql(
      `insert into book (id, family_id, story_version_id, title, status)
       select $2, family_id, story_version_id, title, 'ordered' from book where id = $1`,
      [bookId, other],
    );
    await sql("insert into book_order (id, book_id, placed_by, price_cents, currency) values ($1, $2, $3, 0, 'USD')", [
      `order_${id}`,
      other,
      userId,
    ]);
    expect((await upload("hero", "ordered.png")).status()).toBe(429);
    await sql("update book set status = 'approved' where id = $1", [other]);
    expect((await upload("hero", "approved.png")).status()).toBe(200);
  } finally {
    await parent.context.close();
  }
});
