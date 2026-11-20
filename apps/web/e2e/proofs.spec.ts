import { expect, test } from "@playwright/test";
import type { ServerServices } from "@lifestory/core";
import type { Effect } from "effect";

// Chromium writes page dictionaries and font names uncompressed, so the PDF's structure can be read from its bytes.
const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString("latin1");
  return {
    pages: text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    fonts: [...new Set([...text.matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]))],
  };
};

test("a parent makes a print-ready PDF proof of a book, and only the family downloads it", async ({ page, browser, request }) => {
  // A book of the sample story with two new family members, made directly (books.spec.ts makes one in the UI).
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const { createBook, createCharacter, listBooks, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const look = { face: "face:round", features: "features:defined", skin: "skin:s3", hair: "hair:curly", hairColour: "hair-colour:black", glasses: "glasses:round", facialHair: "facial-hair:none" } as const;
  let bookId = "";
  try {
    const [parent, family] = ["user_parent", "org_example_family"];
    const hero = await run(createCharacter(parent, family, { name: `Ivy ${suffix}`, title: null, pronouns: "she/her", look: { ...look, age: "young-child" } }));
    const grown = await run(createCharacter(parent, family, { name: `Ray ${suffix}`, title: "Dad", pronouns: "he/him", look: { ...look, age: "adult" } }));
    // Another copy next to the family's books of the story from earlier tests and runs (D47).
    const existing = (await run(listBooks(parent, family))).books.map((book) => book.id);
    ({ id: bookId } = await run(createBook(parent, family, { slug: "the-moon-picnic", cast: { hero: hero.id, grownup: grown.id }, existing })));
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
  await expect(proofs.first()).toContainText("6 pages");

  const href = await proofs.first().getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/families\/[^/]+\/proofs\/proof_[\w-]+\.pdf$/);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment/);
  // One PDF page per book page, with the story's font, and print-ready for Lulu (D35): 8.5 in trim + 0.125 in bleed
  // per side with TrimBox and BleedBox, nothing transparent, fonts embedded, art at 300 ppi.
  const pdf = await download.body();
  const facts = pdfFacts(pdf);
  expect(facts.pages).toBe(6);
  expect(facts.fonts).toContain("Literata-Regular");
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const { checkPrintReady } = await import("@lifestory/core");
  const printReady = await checkPrintReady(pdf, { widthIn: 8.5, heightIn: 8.5 });
  expect(printReady.issues).toEqual([]);
  expect(printReady.images).toHaveLength(6);
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
