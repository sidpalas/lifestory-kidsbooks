import { readFileSync } from "node:fs";

import { type Browser, expect, type Page, test } from "@playwright/test";

// The whole milestone 1 slice (docs/brief.md, "Milestone 1 scope"), in order, as the people in it do it: the operator
// invites a family, its owner invites a view-only grandparent, adds family members with their ages, makes a book of the
// sample story with them, edits a page's text, then downloads the PDF proof
// and approves it, and the grandparent reads the book and the approved proof without being able to change them.
// The other specs cover each part's edge cases. Every run uses fresh accounts, so runs don't depend on each other.
const PASSWORD = "a-long-test-password";

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

/** A signed-out page of its own, so each person keeps their session. The test closes its context: the test browser outlives the test. */
const personPage = async (browser: Browser) => (await browser.newContext()).newPage();

/** The link in the newest email to `to`, from the dev mailbox, as a same-origin path. */
const emailedLink = async (page: Page, to: string) => {
  await page.goto("/__dev/mailbox");
  const href = await page.locator(`article[data-to="${to}"] a`).first().getAttribute("href");
  expect(href, `an email to ${to}`).toBeTruthy();
  const url = new URL(href!);
  return url.pathname + url.search;
};

// Chromium writes page dictionaries and font names uncompressed, so the PDF's structure can be read from its bytes.
const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString("latin1");
  return {
    pages: text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    mediaBoxes: [
      ...new Set([...text.matchAll(/\/MediaBox\s*\[\s*([^\]]*?)\s*\]/g)].map((match) => `/MediaBox [${match[1]}]`)),
    ],
    fonts: [...new Set([...text.matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]))],
  };
};

test("milestone 1: invite, family, viewer, characters, a book, a text edit, an approved PDF proof", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const ownerEmail = `robin-${id}@example.com`;
  const granEmail = `gran-${id}@example.com`;
  const child = `Ada ${id}`;
  const grownup = `Sam ${id}`;

  // 1. Sign up by invite: the operator invites a new family; the invitee sets a password from the emailed link and
  // arrives as the owner of their own family.
  const operator = await personPage(browser);
  await operator.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/admin");
  const inviteFamily = operator.getByRole("form", { name: "Invite a new family" });
  await inviteFamily.getByLabel("Name").fill("Robin");
  await inviteFamily.getByLabel("Email").fill(ownerEmail);
  await inviteFamily.getByRole("button", { name: "Invite family" }).click();
  await expect(operator.getByTestId("invite-family").getByRole("status")).toContainText(
    `Invitation sent to ${ownerEmail}`,
  );
  const setPassword = await emailedLink(operator, ownerEmail);
  await operator.context().close();

  const owner = await personPage(browser);
  await owner.goto(setPassword);
  await owner.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await owner.getByLabel("Repeat the password").fill(PASSWORD);
  await owner.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(owner.getByTestId("signed-in-as")).toHaveText(`Signed in as Robin (${ownerEmail})`);
  await expect(owner.getByTestId("families")).toHaveText("Robin's family");
  await owner.goto("/sharing");
  await expect(owner.getByTestId("members")).toContainText("Owner");

  // 2. The owner invites the grandparent with the view-only role, and she joins with an account of her own.
  const inviteMember = owner.getByRole("form", { name: "Invite someone" });
  await inviteMember.getByLabel("Email").fill(granEmail);
  await inviteMember.getByLabel("Role").selectOption({ label: "Viewer (read only)" });
  await inviteMember.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.getByRole("status")).toHaveText(`Invitation sent to ${granEmail}.`);
  const invitation = await emailedLink(owner, granEmail);

  const gran = await personPage(browser);
  await gran.goto(invitation);
  await expect(gran.getByText("Join Robin's family")).toBeVisible();
  await gran.getByLabel("Your name").fill("Gran");
  await gran.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await gran.getByLabel("Repeat the password").fill(PASSWORD);
  await gran.getByRole("button", { name: "Create account and join" }).click();
  await expect(gran.getByTestId("families")).toHaveText("Robin's family");
  await gran.goto("/sharing");
  await expect(gran.getByTestId("family-panel")).toContainText("You're a viewer");

  // 3. The owner adds two family members: a name, pronouns, what the kids call them, and an age (D29).
  await owner.goto("/family/new");
  await owner.getByLabel("Name").fill(child);
  await owner.getByLabel("Pronouns").selectOption("she/her");
  await owner.getByLabel("Age").selectOption("young-child");
  await evidence(owner, "m1-character");
  await owner.getByRole("button", { name: "Add to the family" }).click();
  await expect(owner.getByTestId("characters")).toContainText(child);

  await owner.goto("/family/new");
  await owner.getByLabel("Name").fill(grownup);
  await owner.getByLabel("Pronouns").selectOption("he/him");
  await owner.getByLabel(/What the kids call them/).fill("Dad");
  await owner.getByLabel("Age").selectOption("adult");
  await owner.getByRole("button", { name: "Add to the family" }).click();
  await expect(owner.getByTestId("characters")).toContainText(grownup);

  // 4. A book of the sample story: the text names them.
  await owner.goto("/stories/the-kite-day");
  const make = owner.getByRole("list", { name: "Roles" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: grownup });
  await owner.getByRole("button", { name: "Make the book" }).click();
  await expect(owner).toHaveURL(/\/books\/book_/);
  const bookPath = new URL(owner.url()).pathname;
  const allPages = owner.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(allPages).toHaveCount(3);
  await expect(allPages.nth(2)).toContainText(`“Same time tomorrow?” asked Dad. ${child} nodded, all smiles.`);
  await imagesLoaded(owner);

  // 5. Edit page 1's paragraph in the editor, which shows the page as it will print (8.5 in trim + bleed = 840 px).
  const editor = owner.getByTestId("editor-page");
  expect(await editor.getByTestId("book-page").evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(840);
  await owner
    .getByRole("textbox", { name: "Text block 2" })
    .fill("{{hero.name}} and {{grownup.title}} carried the kite up the hill.");
  await expect(editor).toContainText(`${child} and Dad carried the kite up the hill.`);
  await owner.getByRole("button", { name: "Save text block 2" }).click();
  await expect(owner.getByText("Paragraph 2 · edited")).toBeVisible();
  await owner.reload();
  await expect(owner.getByTestId("editor-page")).toContainText(`${child} and Dad carried the kite up the hill.`);
  await imagesLoaded(owner);
  await evidence(owner, "m1-editor");

  // 6. A PDF proof of the whole book: the worker renders it, the owner downloads it, checks it, and approves it.
  const proofs = owner.getByRole("region", { name: "PDF proofs" });
  await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
  const proof = proofs.getByTestId("proof").first();
  await expect(proof).toContainText(`${child} & ${grownup}`);
  await expect(proof).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proof).toHaveAttribute("data-approved", "false");
  await expect(proof).toContainText("unless approved");
  const downloading = owner.waitForEvent("download");
  await proof.getByRole("link", { name: /Download PDF \(3 pages/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^proof_[\w-]+\.pdf$/);
  const pdf = readFileSync((await download.path())!);
  // One PDF page per book page, each 8.5 in trim + 0.125 in bleed per side = 630 pt, in the story's own font.
  expect(pdfFacts(pdf)).toEqual(expect.objectContaining({ pages: 3, mediaBoxes: ["/MediaBox [0 0 630 630]"] }));
  expect(pdfFacts(pdf).fonts).toContain("Literata-Regular");
  if (process.env.E2E_SCREENSHOTS) await download.saveAs(`${process.env.E2E_SCREENSHOTS}/m1-proof.pdf`);

  await proof.getByRole("button", { name: "Approve for print" }).click();
  await expect(proof).toHaveAttribute("data-approved", "true");
  await expect(proof.getByTestId("proof-approval")).toContainText("Approved for print by Robin on");
  await expect(proof.getByRole("button", { name: "Approve for print" })).toHaveCount(0);
  await evidence(owner, "m1-approved");

  // The grandparent reads the book with the edit and the approval, downloads the proof, and can change nothing.
  await gran.goto(bookPath);
  await expect(gran.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(3);
  await expect(gran.getByTestId("editor-page")).toContainText(`${child} and Dad carried the kite up the hill.`);
  await expect(gran.getByText("you're a viewer")).toBeVisible();
  await expect(gran.getByRole("button", { name: /Save text/ })).toHaveCount(0);
  const granProof = gran.getByRole("region", { name: "PDF proofs" }).getByTestId("proof").first();
  await expect(granProof.getByTestId("proof-approval")).toContainText("Approved for print by Robin");
  await expect(gran.getByRole("button", { name: "Make a PDF proof" })).toHaveCount(0);
  await expect(gran.getByRole("button", { name: "Approve for print" })).toHaveCount(0);
  const href = await granProof.getByRole("link", { name: /Download PDF/ }).getAttribute("href");
  expect((await gran.request.get(href!)).status()).toBe(200);
  await Promise.all([owner, gran].map((person) => person.context().close()));
});
