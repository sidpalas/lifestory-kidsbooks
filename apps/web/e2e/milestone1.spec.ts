import { readFileSync } from "node:fs";
import { type Browser, expect, type Page, test } from "@playwright/test";

// The whole milestone 1 slice (docs/brief.md, "Milestone 1 scope"), in order, as the people in it do it: the operator
// invites a family, its owner invites a view-only grandparent, adds family members in the picker, makes a book of the
// sample story with them, changes a look and sees it on every page, edits a page's text, then downloads the PDF proof
// and approves it, and the grandparent reads the book and the approved proof without being able to change them.
// The other specs cover each part's edge cases. Every run uses fresh accounts, so runs don't depend on each other.
const PASSWORD = "a-long-test-password";

/** Saves a screenshot for the report when E2E_SCREENSHOTS names a directory. */
const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};

const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);

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

/** The image URLs of every page in the editor's page list, per page. */
const pageSources = (page: Page) =>
  page
    .getByRole("region", { name: "All pages" })
    .getByTestId("book-page")
    .evaluateAll((pages) => pages.map((el) => [...el.querySelectorAll("img")].map((img) => img.getAttribute("src"))));

// Chromium writes page dictionaries and font names uncompressed, so the PDF's structure can be read from its bytes.
const pdfFacts = (pdf: Buffer) => {
  const text = pdf.toString("latin1");
  return {
    pages: text.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0,
    mediaBoxes: [...new Set([...text.matchAll(/\/MediaBox\s*\[\s*([^\]]*?)\s*\]/g)].map((match) => `/MediaBox [${match[1]}]`))],
    fonts: [...new Set([...text.matchAll(/\/FontName\s*\/[A-Z]{6}\+([\w-]+)/g)].map((match) => match[1]))],
  };
};

test("milestone 1: invite, family, viewer, characters, a personalized book, a look change, a text edit, an approved PDF proof", async ({ browser }) => {
  test.setTimeout(180_000);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const ownerEmail = `robin-${id}@example.com`;
  const granEmail = `gran-${id}@example.com`;
  const child = `Ada ${id}`;
  const grownup = `Sam ${id}`;

  // 1. Sign up by invite: the operator invites a new family; the invitee sets a password from the emailed link and
  // arrives as the owner of their own family.
  const operator = await personPage(browser);
  await operator.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
  const inviteFamily = operator.getByRole("form", { name: "Invite a new family" });
  await inviteFamily.getByLabel("Name").fill("Robin");
  await inviteFamily.getByLabel("Email").fill(ownerEmail);
  await inviteFamily.getByRole("button", { name: "Invite family" }).click();
  await expect(operator.getByTestId("invite-family").getByRole("status")).toContainText(`Invitation sent to ${ownerEmail}`);
  const setPassword = await emailedLink(operator, ownerEmail);
  await operator.context().close();

  const owner = await personPage(browser);
  await owner.goto(setPassword);
  await owner.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await owner.getByLabel("Repeat the password").fill(PASSWORD);
  await owner.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(owner.getByTestId("signed-in-as")).toHaveText(`Signed in as Robin (${ownerEmail})`);
  await expect(owner.getByTestId("families")).toHaveText("Robin's family");
  await expect(owner.getByTestId("members")).toContainText("Owner");

  // 2. The owner invites the grandparent with the view-only role, and she joins with an account of her own.
  const inviteMember = owner.getByRole("form", { name: "Invite a family member" });
  await inviteMember.getByLabel("Invite someone by email").fill(granEmail);
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
  await expect(gran.getByTestId("family-panel")).toContainText("You're a viewer");

  // 3. The owner adds two family members in the picker: an age, a curated look of that age, then one feature at a
  // time, with the portrait following each choice.
  await owner.goto("/characters/new");
  await owner.getByLabel("Name").fill(child);
  await owner.getByLabel("Pronouns").selectOption("she/her");
  await owner.getByRole("button", { name: "Young child", exact: true }).click();
  await owner.getByRole("button", { name: "Curly black hair", exact: true }).click();
  const preview = owner.getByTestId("look-preview");
  const curly = await preview.getAttribute("src");
  await owner.getByRole("button", { name: "Long hair" }).click();
  await expect(preview).not.toHaveAttribute("src", curly!);
  await owner.getByRole("button", { name: "Round glasses" }).click();
  await expect(owner.getByTestId("look-summary")).toHaveText("Young child, round face, brown skin, long black hair, glasses");
  await imagesLoaded(owner);
  await evidence(owner, "m1-picker");
  await owner.getByRole("button", { name: "Add to the family" }).click();
  await expect(owner.getByTestId("characters")).toContainText(child);

  await owner.goto("/characters/new");
  await owner.getByLabel("Name").fill(grownup);
  await owner.getByLabel("Pronouns").selectOption("he/him");
  await owner.getByLabel(/What the kids call them/).fill("Dad");
  await owner.getByRole("button", { name: "Adult", exact: true }).click();
  await owner.getByRole("button", { name: "Short blonde hair, glasses", exact: true }).click();
  await owner.getByRole("button", { name: "Add to the family" }).click();
  await expect(owner.getByTestId("characters")).toContainText(grownup);

  // 4. A personalized book of the sample story: every page is composed with them, and the text names them.
  await owner.goto("/stories/the-moon-picnic");
  const make = owner.getByRole("list", { name: "Roles" });
  await make.getByLabel(/The child/).selectOption({ label: child });
  await make.getByLabel(/A grown-up/).selectOption({ label: grownup });
  await owner.getByRole("button", { name: "Make the book" }).click();
  await expect(owner).toHaveURL(/\/books\/book_/);
  const bookPath = new URL(owner.url()).pathname;
  const allPages = owner.getByRole("region", { name: "All pages" }).getByTestId("book-page");
  await expect(allPages).toHaveCount(6);
  await expect(allPages.nth(2)).toContainText(`Dad checked the fuel. ${child} checked the cocoa. She buckled herself in tight.`);
  await imagesLoaded(owner);

  // 5. A look change applies on every page right away: Ada is on all six, so each page gets a recoloured layer.
  const before = await pageSources(owner);
  await owner.getByTestId("role-hero").getByRole("link", { name: "Edit saved look" }).click();
  await owner.getByRole("button", { name: "Blonde hair colour" }).click();
  await owner.getByRole("button", { name: "Save changes" }).click();
  // Saving returns home; opening the book sooner can read the look from before the save.
  await expect(owner).toHaveURL(/\/$/);
  await owner.goto(bookPath);
  await expect(allPages).toHaveCount(6);
  await imagesLoaded(owner);
  const after = await pageSources(owner);
  expect(after.map((sources, page) => sources.filter((src, layer) => src !== before[page]![layer]).length).every((changed) => changed >= 1)).toBe(true);
  expect(after.flat()).toHaveLength(before.flat().length);

  // 6. Edit page 1's paragraph in the editor, which shows the page as it will print (8.5 in trim + bleed = 840 px).
  const editor = owner.getByTestId("editor-page");
  expect(await editor.getByTestId("book-page").evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(840);
  await owner.getByRole("textbox", { name: "Text block 2" }).fill("{{hero.name}} packed the basket with {{grownup.title}}'s moon cheese.");
  await expect(editor).toContainText(`${child} packed the basket with Dad's moon cheese.`);
  await owner.getByRole("button", { name: "Save text block 2" }).click();
  await expect(owner.getByText("Paragraph 2 · edited")).toBeVisible();
  await owner.reload();
  await expect(owner.getByTestId("editor-page")).toContainText(`${child} packed the basket with Dad's moon cheese.`);
  await imagesLoaded(owner);
  await evidence(owner, "m1-editor");

  // 7. A PDF proof of the whole book: the worker renders it, the owner downloads it, checks it, and approves it.
  const proofs = owner.getByRole("region", { name: "PDF proofs" });
  await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
  const proof = proofs.getByTestId("proof").first();
  await expect(proof).toContainText(`${child} & ${grownup}`);
  await expect(proof).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(proof).toHaveAttribute("data-approved", "false");
  await expect(proof).toContainText("unless approved");
  const downloading = owner.waitForEvent("download");
  await proof.getByRole("link", { name: /Download PDF \(6 pages/ }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^proof_[\w-]+\.pdf$/);
  const pdf = readFileSync((await download.path())!);
  // One PDF page per book page, each 8.5 in trim + 0.125 in bleed per side = 630 pt, in the story's own font.
  expect(pdfFacts(pdf)).toEqual(expect.objectContaining({ pages: 6, mediaBoxes: ["/MediaBox [0 0 630 630]"] }));
  expect(pdfFacts(pdf).fonts).toContain("Literata-Regular");
  if (process.env.E2E_SCREENSHOTS) await download.saveAs(`${process.env.E2E_SCREENSHOTS}/m1-proof.pdf`);

  await proof.getByRole("button", { name: "Approve for print" }).click();
  await expect(proof).toHaveAttribute("data-approved", "true");
  await expect(proof.getByTestId("proof-approval")).toContainText("Approved for print by Robin on");
  await expect(proof.getByRole("button", { name: "Approve for print" })).toHaveCount(0);
  await evidence(owner, "m1-approved");

  // The grandparent reads the book with the edit and the approval, downloads the proof, and can change nothing.
  await gran.goto(bookPath);
  await expect(gran.getByRole("region", { name: "All pages" }).getByTestId("book-page")).toHaveCount(6);
  await expect(gran.getByTestId("editor-page")).toContainText(`${child} packed the basket with Dad's moon cheese.`);
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
