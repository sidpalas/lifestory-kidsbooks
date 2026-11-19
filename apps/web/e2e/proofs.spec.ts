import { expect, test } from "@playwright/test";

// Chromium writes page dictionaries and font names uncompressed, so the PDF's structure can be read from its bytes.
const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString("latin1");
  return {
    pages: text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    mediaBoxes: [...new Set(text.match(/\/MediaBox\s*\[[^\]]*\]/g))],
    fonts: [...new Set([...text.matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]))],
  };
};

test("a parent makes a PDF proof of the story with a chosen look, and the family downloads it", async ({ page, browser, request }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/stories/the-moon-picnic");
  await expect(page.getByTestId("book-page")).toHaveCount(6);
  await page.getByLabel("The child: Glasses").selectOption("glasses:round");
  await expect(page).toHaveURL(/glasses/);

  const proofs = page.getByTestId("proof");
  const before = await proofs.count();
  await page.getByRole("button", { name: "Make a PDF proof" }).click();
  await expect(proofs).toHaveCount(before + 1);
  // The worker renders it with headless Chromium; the list polls until it's ready.
  await expect(proofs.first()).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proofs.first()).toContainText("Mia & Joe");
  await expect(proofs.first()).toContainText("6 pages");

  const href = await proofs.first().getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect(href).toMatch(/^\/api\/files\/families\/[^/]+\/proofs\/proof_[\w-]+\.pdf$/);
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toBe("application/pdf");
  expect(download.headers()["content-disposition"]).toMatch(/^attachment/);
  // One PDF page per book page, each 8.5 in trim + 0.125 in bleed per side = 8.75 in = 630 pt, with the story's font.
  const facts = pdfFacts(await download.body());
  expect(facts.pages).toBe(6);
  expect(facts.mediaBoxes).toEqual(["/MediaBox [0 0 630 630]"]);
  expect(facts.fonts).toContain("Literata-Regular");

  // The grandparent is a viewer in the same family: they can download proofs but not make them.
  const viewer = await browser.newPage();
  await viewer.goto("/__dev/log-me-in/grandparent@lifestory.dev?returnTo=/stories/the-moon-picnic");
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
