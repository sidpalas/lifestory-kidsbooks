import type { ServerServices } from "@lifestory/core";
import { expect, test } from "@playwright/test";
import { Effect } from "effect";

// Chromium writes page dictionaries and font names uncompressed, so the PDF's structure can be read from its bytes.
const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString("latin1");
  return {
    pages: text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    fonts: [...new Set([...text.matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]))],
  };
};

test("a parent makes a print-ready PDF proof of a book, and only the family downloads it", async ({
  page,
  browser,
  request,
}) => {
  // A book of the sample story with two new family members, made directly (books.spec.ts makes one in the UI).
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const { createBook, listBooks, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  let bookId = "";
  try {
    const [parent, family] = ["user_parent", "org_example_family"];
    const hero = {
      name: `Ivy ${suffix}`,
      title: null,
      pronouns: "she/her",
      age: "young-child",
    } as const;
    const grown = {
      name: `Ray ${suffix}`,
      title: "Dad",
      pronouns: "he/him",
      age: "adult",
    } as const;
    // Another copy next to the family's books of the story from earlier tests and runs (D47).
    const existing = (await run(listBooks(parent, family))).books.map((book) => book.id);
    ({ id: bookId } = await run(
      createBook(parent, family, { slug: "the-kite-day", cast: { hero: hero, grownup: grown }, existing }),
    ));
  } finally {
    await runtime.dispose();
  }

  await page.goto(`/__dev/log-me-in/parent@lifestory.dev?returnTo=/books/${bookId}`);
  const proofs = page.getByRole("region", { name: "PDF proofs" }).getByTestId("proof");
  await expect(proofs).toHaveCount(0);
  await page.getByRole("button", { name: "Make a PDF proof" }).click();
  await expect(proofs).toHaveCount(1);
  // The worker renders it with headless Chromium; the list polls until it's ready.
  await expect(proofs.first()).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proofs.first()).toContainText(`Ivy ${suffix} & Ray ${suffix}`);
  await expect(proofs.first()).toContainText("3 pages");

  const href = await proofs
    .first()
    .getByRole("link", { name: /Download PDF/ })
    .getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/families\/[^/]+\/proofs\/proof_[\w-]+\.pdf$/);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment/);
  // One PDF page per book page, with the story's font, and print-ready for Lulu (D35): 8.5 in trim + 0.125 in bleed
  // per side with TrimBox and BleedBox, nothing transparent, fonts embedded, art at 300 ppi.
  const pdf = await download.body();
  const facts = pdfFacts(pdf);
  expect(facts.pages).toBe(3);
  expect(facts.fonts).toContain("Literata-Regular");
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const { checkPrintReady } = await import("@lifestory/core");
  const printReady = await checkPrintReady(pdf, { widthIn: 8.5, heightIn: 8.5 });
  expect(printReady.issues).toEqual([]);
  expect(printReady.images).toHaveLength(3);
  expect(printReady.images.every((image) => image.ppi === 300)).toBe(true);

  // The grandparent is a viewer in the same family: they can download proofs but not make them.
  const viewer = await browser.newPage();
  await viewer.goto(`/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/books/${bookId}`);
  await expect(viewer.getByTestId("proof").first()).toHaveAttribute("data-status", "ready");
  await expect(viewer.getByRole("button", { name: "Make a PDF proof" })).toHaveCount(0);
  expect((await viewer.request.get(href!)).status()).toBe(200);
  await viewer.close();

  // Someone in another family can't, even with the link, and nobody signed out can.
  const outsider = await browser.newPage();
  await outsider.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
  expect((await outsider.request.get(href!)).status()).toBe(404);
  await outsider.close();
  expect((await request.get(href!)).status()).toBe(401);
});

test("the print page needs the worker's print token, not a session", async ({ page }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  for (const query of ["", "?token=forged.signature"]) {
    expect((await page.request.get(`/print/proofs/proof_does-not-matter${query}`)).status()).toBe(404);
  }
});

test("a parent deletes proofs, rendering, failed, ready, or approved after a stronger warning; viewers and outsiders can't", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const core = await import("@lifestory/core");
  const runtime = core.makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  // "ok", or the tag of the typed error the call fails with.
  const outcome = <A, E>(effect: Effect.Effect<A, E, ServerServices>) =>
    run(effect.pipe(Effect.match({ onSuccess: () => "ok", onFailure: (error) => (error as { _tag: string })._tag })));
  const proofRow = async (id: string) => {
    const result = await run(
      core.Database.use(({ pool }) =>
        Effect.promise(() => pool.query("select task_id from proof where id = $1", [id])),
      ),
    );
    return result.rows[0] as { task_id: string } | undefined;
  };
  try {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const [parent, family] = ["user_parent", "org_example_family"];
    const hero = {
      name: `Nell ${suffix}`,
      title: null,
      pronouns: "she/her",
      age: "young-child",
    } as const;
    const grown = {
      name: `Abe ${suffix}`,
      title: "Dad",
      pronouns: "he/him",
      age: "adult",
    } as const;
    const existing = (await run(core.listBooks(parent, family))).books.map((book) => book.id);
    const { id: bookId } = await run(
      core.createBook(parent, family, {
        slug: "the-kite-day",
        cast: { hero: hero, grownup: grown },
        existing,
      }),
    );

    // Rendering: deleting it right after the request removes the row and cancels the render, which takes seconds.
    const rendering = await run(core.requestBookProof(parent, bookId));
    const renderTask = (await proofRow(rendering.id))!.task_id;
    expect(await outcome(core.deleteProof(parent, rendering.id))).toBe("ok");
    expect(await proofRow(rendering.id)).toBeUndefined();
    expect((await run(core.Jobs.use((jobs) => jobs.status(renderTask)))).state).toBe("cancelled");

    // Failed: a proof whose render stopped. Then two that render: one to approve, one to delete as a draft.
    const failed = await run(core.requestBookProof(parent, bookId));
    const failedTask = (await proofRow(failed.id))!.task_id;
    await run(core.Jobs.use((jobs) => jobs.cancel(failedTask)));
    const approved = await run(core.requestBookProof(parent, bookId));
    const draft = await run(core.requestBookProof(parent, bookId));

    await page.goto(`/__dev/log-me-in/parent@lifestory.dev?returnTo=/books/${bookId}`);
    const row = (id: string) => page.getByTestId("proof").and(page.locator(`[data-proof-id="${id}"]`));
    // The panel loads its list after the page; on a cold dev server that takes a while.
    await expect(page.getByRole("button", { name: "Make a PDF proof" })).toBeVisible({ timeout: 30_000 });
    await expect(row(failed.id)).toHaveAttribute("data-status", "failed");
    for (const id of [approved.id, draft.id])
      await expect(row(id)).toHaveAttribute("data-status", "ready", { timeout: 90_000 });
    await run(core.approveProof(parent, approved.id));
    await page.reload();
    await expect(row(approved.id)).toHaveAttribute("data-approved", "true");

    // The server decides, whatever the page shows: a viewer may not, and another family's member and an unknown proof
    // find nothing.
    expect(await outcome(core.deleteProof("user_grandparent", draft.id))).toBe("Forbidden");
    expect(await outcome(core.deleteProof("user_operator", draft.id))).toBe("NotFound");
    expect(await outcome(core.deleteProof(parent, "proof_does-not-exist"))).toBe("NotFound");

    // The viewer sees the proofs and no Delete.
    const viewer = await browser.newPage();
    await viewer.goto(`/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/books/${bookId}`);
    await expect(viewer.getByTestId("proof")).toHaveCount(3, { timeout: 30_000 });
    await expect(viewer.getByRole("button", { name: /^Delete proof/ })).toHaveCount(0);
    await viewer.close();

    // A ready draft: the confirmation names it; cancelling keeps it, confirming deletes it and its PDF.
    const href = (await row(draft.id)
      .getByRole("link", { name: /Download PDF/ })
      .getAttribute("href"))!;
    expect((await page.request.get(href)).status()).toBe(200);
    const cancel = page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toMatch(
        new RegExp(`^Delete the proof of Nell ${suffix} & Abe ${suffix}, made .*Its PDF is deleted too`),
      );
      await dialog.dismiss();
    });
    await row(draft.id)
      .getByRole("button", { name: /^Delete proof of/ })
      .click();
    await cancel;
    await expect(row(draft.id)).toHaveCount(1);
    const confirm = page.waitForEvent("dialog").then((dialog) => dialog.accept());
    await row(draft.id)
      .getByRole("button", { name: /^Delete proof of/ })
      .click();
    await confirm;
    await expect(row(draft.id)).toHaveCount(0);
    expect(await proofRow(draft.id)).toBeUndefined();
    expect((await page.request.get(href)).status()).toBe(404);

    // The failed one goes the same way.
    const confirmFailed = page.waitForEvent("dialog").then((dialog) => dialog.accept());
    await row(failed.id)
      .getByRole("button", { name: /^Delete proof of/ })
      .click();
    await confirmFailed;
    await expect(page.getByTestId("proof")).toHaveCount(1);

    // The approved one too (Sid), after a warning that names the approval: its PDF and approval go with it.
    const approvedHref = (await row(approved.id)
      .getByRole("link", { name: /Download PDF/ })
      .getAttribute("href"))!;
    const confirmApproved = page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.message()).toMatch(
        /^Delete the APPROVED proof of .* approved for print by Pat Parent on .*its approval are deleted/,
      );
      await dialog.accept();
    });
    await row(approved.id)
      .getByRole("button", { name: /^Delete proof of/ })
      .click();
    await confirmApproved;
    await expect(page.getByTestId("proof")).toHaveCount(0);
    expect(await proofRow(approved.id)).toBeUndefined();
    expect((await page.request.get(approvedHref)).status()).toBe(404);
    await page.reload();
    await expect(page.getByText("No proofs yet.")).toBeVisible({ timeout: 30_000 });
  } finally {
    await runtime.dispose();
  }
});

test("deleting a book deletes its proofs' PDFs, and no PDF is served without its proof", async ({ page }) => {
  test.setTimeout(150_000);
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const core = await import("@lifestory/core");
  const runtime = core.makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const stored = (key: string) =>
    run(
      core.ObjectStorage.use((storage) => storage.get(key)).pipe(
        Effect.match({ onSuccess: () => true, onFailure: () => false }),
      ),
    );
  try {
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const [parent, family] = ["user_parent", "org_example_family"];
    const hero = {
      name: `Wren ${suffix}`,
      title: null,
      pronouns: "she/her",
      age: "young-child",
    } as const;
    const grown = {
      name: `Otto ${suffix}`,
      title: "Dad",
      pronouns: "he/him",
      age: "adult",
    } as const;
    const existing = (await run(core.listBooks(parent, family))).books.map((book) => book.id);
    const { id: bookId } = await run(
      core.createBook(parent, family, {
        slug: "the-kite-day",
        cast: { hero: hero, grownup: grown },
        existing,
      }),
    );
    const proof = await run(core.requestBookProof(parent, bookId));
    let objectKey = "";
    await expect
      .poll(
        async () => {
          const ready = (await run(core.listBookProofs(parent, bookId))).proofs.find((p) => p.id === proof.id);
          objectKey = ready?.objectKey ?? "";
          return ready?.status;
        },
        { timeout: 90_000 },
      )
      .toBe("ready");
    await run(core.approveProof(parent, proof.id));

    await page.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/");
    const href = `/api/files/${objectKey}`;
    // A viewer of the family downloads it while the proof exists.
    expect((await page.request.get(href)).status()).toBe(200);

    // A PDF under the family with no proof row (one a render wrote after its proof was deleted) isn't served.
    const orphan = `families/${family}/proofs/proof_orphan-${suffix}.pdf`;
    await run(
      core.ObjectStorage.use((storage) => storage.put(orphan, new Uint8Array([37, 80, 68, 70]), "application/pdf")),
    );
    expect((await page.request.get(`/api/files/${orphan}`)).status()).toBe(404);
    await run(core.ObjectStorage.use((storage) => storage.delete(orphan)));

    // Deleting the book deletes its approved proof and the PDF itself, not just the row.
    await run(core.deleteBook(parent, bookId));
    expect(await stored(objectKey)).toBe(false);
    expect((await page.request.get(href)).status()).toBe(404);
  } finally {
    await runtime.dispose();
  }
});
