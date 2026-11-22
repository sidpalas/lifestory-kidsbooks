import { expect, type Page, test } from "@playwright/test";

// Families and invites (docs/plan.md "Invites and families"). Every run uses fresh emails,
// so the tests don't depend on each other or on earlier runs.
const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const PASSWORD = "a-long-test-password";

/** The link in the newest email to `to`, from the dev mailbox, as a same-origin path. */
const emailedLink = async (page: Page, to: string) => {
  await page.goto("/__dev/mailbox");
  const href = await page.locator(`article[data-to="${to}"] a`).first().getAttribute("href");
  expect(href, `an email to ${to}`).toBeTruthy();
  const url = new URL(href ?? "");
  return url.pathname + url.search;
};

const signOut = async (page: Page) => {
  // On a phone, Sign out is in the Menu sheet.
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
};

const signInWithPassword = async (page: Page, email: string) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText(email);
};

const inviteMember = async (page: Page, email: string, role: "Viewer (read only)" | "Editor (can edit)") => {
  const form = page.getByRole("form", { name: "Invite someone" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Role").selectOption({ label: role });
  await form.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("status")).toHaveText(`Invitation sent to ${email}.`);
};

test("the operator invites a new family, whose owner sets a password and invites a view-only grandparent", async ({
  page,
}) => {
  const id = unique();
  const ownerEmail = `robin-${id}@example.com`;
  const granEmail = `gran-${id}@example.com`;

  // The operator invites a family: the account and its family exist from now on.
  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/admin");
  const inviteFamily = page.getByRole("form", { name: "Invite a new family" });
  await inviteFamily.getByLabel("Name").fill("Robin");
  await inviteFamily.getByLabel("Email").fill(ownerEmail);
  await inviteFamily.getByRole("button", { name: "Invite family" }).click();
  await expect(page.getByTestId("invite-family").getByRole("status")).toContainText(`Invitation sent to ${ownerEmail}`);
  await signOut(page);

  // The invitee chooses a password from the emailed link and lands in their own family as owner.
  const setPasswordPath = await emailedLink(page, ownerEmail);
  expect(setPasswordPath).toMatch(/^\/set-password\//);
  await page.goto(setPasswordPath);
  await expect(page.getByText("Welcome, Robin")).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText(`Signed in as Robin (${ownerEmail})`);
  await expect(page.getByTestId("families")).toHaveText("Robin's family");
  await page.goto("/sharing");
  await expect(page.getByTestId("members")).toContainText("Owner");

  // The link works once.
  await page.goto(setPasswordPath);
  await expect(page.getByText("This link has expired")).toBeVisible();

  // The owner invites a grandparent with the view-only role.
  await page.goto("/sharing");
  await inviteMember(page, granEmail, "Viewer (read only)");
  const invitation = page.getByTestId("invitation").filter({ hasText: granEmail });
  await expect(invitation).toContainText("Invitation pending");
  await expect(invitation).toContainText("Viewer (read only)");
  await signOut(page);

  // The grandparent creates an account from the invitation and joins as a viewer, with no family of their own.
  await page.goto(await emailedLink(page, granEmail));
  await expect(page.getByText("Join Robin's family")).toBeVisible();
  await expect(page.getByText(`Robin invited ${granEmail} to view its books.`)).toBeVisible();
  await page.getByLabel("Your name").fill("Gran");
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByTestId("signed-in-as")).toHaveText(`Signed in as Gran (${granEmail})`);
  await expect(page.getByTestId("families")).toHaveText("Robin's family");
  await page.goto("/sharing");
  await expect(page.getByTestId("family-panel")).toContainText("You're a viewer: you can read this family's books");
  await expect(page.getByRole("form", { name: "Invite someone" })).toHaveCount(0);

  // A viewer can't invite anyone, even by calling Better Auth directly.
  const origin = new URL(page.url()).origin;
  const refused = await page.request.post("/api/auth/organization/invite-member", {
    data: { email: `someone-${id}@example.com`, role: "viewer" },
    headers: { origin },
  });
  expect(refused.status()).toBe(403);

  // The owner signs in again with the password they chose.
  await signOut(page);
  await signInWithPassword(page, ownerEmail);
  await page.goto("/sharing");
  // Accepted: Gran is a member with her name over her email, and the invitation is gone.
  await expect(page.getByTestId("member").filter({ hasText: granEmail })).toHaveText(
    `Gran${granEmail}Viewer (read only)`,
  );
  await expect(page.getByTestId("invitations")).toHaveCount(0);
});

test("an existing user accepts an invitation into a second family and switches between them", async ({ page }) => {
  const id = unique();
  const ownerEmail = `alex-${id}@example.com`;
  const friendEmail = `sam-${id}@example.com`;

  // New accounts from the dev sign-in route get a one-person family too.
  await page.goto(`/__dev/log-me-in/${friendEmail}?returnTo=/`);
  await expect(page.getByTestId("families")).toHaveText(`sam-${id}'s family`);
  // Families come only from the operator's invite and accounts.ts (D23): a user can't make one through Better Auth.
  const created = await page.request.post("/api/auth/organization/create", {
    data: { name: "Another family", slug: `another-${id}` },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(created.status()).toBe(403);
  await page.reload();
  await expect(page.getByTestId("families")).toHaveText(`sam-${id}'s family`);
  await signOut(page);
  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/`);
  await expect(page.getByTestId("families")).toHaveText(`alex-${id}'s family`);
  await page.goto("/sharing");
  await inviteMember(page, friendEmail, "Editor (can edit)");
  await signOut(page);

  // The friend, who already has an account, accepts: the new family joins theirs and becomes active.
  const invitationPath = await emailedLink(page, friendEmail);
  await page.goto(`/__dev/log-me-in/${friendEmail}?returnTo=${encodeURIComponent(invitationPath)}`);
  await expect(page.getByText(`Join alex-${id}'s family`)).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  const switcher = page.getByRole("combobox", { name: "Family" });
  await expect(switcher.locator("option:checked")).toHaveText(`alex-${id}'s family`);
  await page.goto("/sharing");
  await expect(page.getByTestId("family-panel")).toContainText(
    "You're an editor: you can make and edit this family's books.",
  );
  await expect(page.getByTestId("member").filter({ hasText: ownerEmail })).toHaveText(`alex-${id}${ownerEmail}Owner`);

  // Switching back shows their own family, and the choice sticks across reloads.
  await switcher.selectOption({ label: `sam-${id}'s family` });
  await expect(page.getByTestId("family-panel")).toContainText("You're the family's owner");
  await page.reload();
  await expect(switcher.locator("option:checked")).toHaveText(`sam-${id}'s family`);

  // On a phone the switcher and Sign out live in the Menu sheet.
  await page.setViewportSize({ width: 375, height: 740 });
  await page.getByRole("button", { name: "Menu" }).click();
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(menu.getByRole("button", { name: `sam-${id}'s family` })).toHaveAttribute("aria-current", "true");
  await menu.getByRole("button", { name: `alex-${id}'s family` }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId("family-panel")).toContainText("You're an editor");
  await page.getByRole("button", { name: "Menu" }).click();
  await menu.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
});

test("the owner renames the family, and a viewer sees the new name but can't rename it", async ({ page }) => {
  const id = unique();
  const ownerEmail = `rio-${id}@example.com`;
  const viewerEmail = `nana-${id}@example.com`;
  const newName = `The Rivera family ${id}`;
  // Renames the session's active family through Better Auth's endpoint, skipping the app.
  const renameDirectly = (data: Record<string, unknown>) =>
    page.request.post("/api/auth/organization/update", {
      data: { data },
      headers: { origin: new URL(page.url()).origin },
    });

  // The viewer-to-be has an account of their own, so they'll see the switcher.
  await page.goto(`/__dev/log-me-in/${viewerEmail}?returnTo=/`);
  await signOut(page);

  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/sharing`);
  await expect(page.getByTestId("families")).toHaveText(`rio-${id}'s family`);

  // A blank name is refused before it's sent; the saved name is trimmed.
  await page.getByRole("button", { name: "Rename" }).click();
  const form = page.getByRole("form", { name: "Rename the family" });
  await form.getByLabel("Family name").fill("   ");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByRole("alert")).toHaveText("The family needs a name.");
  await form.getByLabel("Family name").fill(`  ${newName}  `);
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.getByTestId("family-name")).toHaveText(newName);
  await expect(page.getByTestId("families")).toHaveText(newName);
  await page.reload();
  await expect(page.getByTestId("families")).toHaveText(newName);

  // Better Auth's own endpoint applies the same rules: no blank or overlong names, and only the name changes.
  expect((await renameDirectly({ name: "  " })).status()).toBe(400);
  expect((await renameDirectly({ name: "x".repeat(61) })).status()).toBe(400);
  expect((await renameDirectly({ name: newName, slug: `taken-${id}` })).status()).toBe(400);

  await inviteMember(page, viewerEmail, "Viewer (read only)");
  await signOut(page);

  // The viewer sees the new name on the invitation, in the switcher, and on the family panel, without a Rename button.
  const invitationPath = await emailedLink(page, viewerEmail);
  await page.goto(`/__dev/log-me-in/${viewerEmail}?returnTo=${encodeURIComponent(invitationPath)}`);
  await expect(page.getByText(`Join ${newName}`)).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.getByRole("combobox", { name: "Family" }).locator("option:checked")).toHaveText(newName);
  await page.goto("/sharing");
  await expect(page.getByTestId("family-name")).toHaveText(newName);
  await expect(page.getByTestId("family-panel")).toContainText("You're a viewer");
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);

  // Nor by calling Better Auth directly: the active family is the one they just joined.
  expect((await renameDirectly({ name: "Nana's now" })).status()).toBe(403);
  await page.reload();
  await expect(page.getByTestId("family-name")).toHaveText(newName);
});

test("on a phone, members show each identity once and long emails and pending invitations fit the screen", async ({
  page,
}) => {
  const id = unique();
  const ownerEmail = `kit-${id}@example.com`;
  const cousinEmail = `cousin-${id}@example.com`;
  const longEmail = `a-very-long-grandparent-address-${id}@extremely-long-family-domain.example.com`;

  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/sharing`);
  await inviteMember(page, cousinEmail, "Editor (can edit)");
  await inviteMember(page, longEmail, "Viewer (read only)");
  await signOut(page);

  // The cousin joins with their email as their name: the row shows it once, not "email (email)".
  await page.goto(await emailedLink(page, cousinEmail));
  await page.getByLabel("Your name").fill(cousinEmail);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText(cousinEmail);
  await page.goto("/sharing");
  await expect(page.getByTestId("member").filter({ hasText: cousinEmail })).toHaveText(`${cousinEmail}Editor`);
  await expect(page.getByTestId("member").filter({ hasText: ownerEmail })).toHaveText(`kit-${id}${ownerEmail}Owner`);

  // The long pending invitation wraps inside its row, keeps its role, and nothing scrolls sideways.
  const pending = page.getByTestId("invitation");
  await expect(pending).toHaveCount(1);
  await expect(pending).toHaveText(`${longEmail}Invitation pendingViewer (read only)`);
  const panel = await page.getByTestId("family-panel").boundingBox();
  const row = await pending.boundingBox();
  expect(row && panel && row.x + row.width <= panel.x + panel.width).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test("only the operator reaches Admin; Studio no longer holds its tools", async ({ page }) => {
  // A parent: no Studio or Admin link, and /admin is not found, its operator actions refused by the server.
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  await expect(page.getByRole("link", { name: "Studio" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await page.goto("/author");
  await expect(page.getByTestId("not-an-author")).toBeVisible();
  await expect(page.getByTestId("invite-family")).toHaveCount(0);
  await page.goto("/admin");
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(page.getByTestId("invite-family")).toHaveCount(0);
  await expect(page.getByTestId("authors")).toHaveCount(0);

  // The operator: Admin sits under Studio in the sidebar and holds Families and Authors; Studio is for stories.
  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
  const sidebar = page.getByRole("complementary", { name: "Lifestory" });
  await sidebar.getByRole("link", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Families" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authors" })).toBeVisible();
  await expect(page.getByTestId("invite-family")).toBeVisible();
  await expect(page.getByTestId("authors")).toBeVisible();
  await sidebar.getByRole("link", { name: "Studio" }).click();
  await expect(page.getByRole("heading", { name: "Write stories" })).toBeVisible();
  await expect(page.getByTestId("invite-family")).toHaveCount(0);
  await expect(page.getByTestId("authors")).toHaveCount(0);
});

test("on a phone, the Menu sheet holds Studio and Admin for the operator and neither for a parent", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  const menuButton = page.getByRole("button", { name: "Menu" });
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await menuButton.click();
  await expect(menu).toContainText("parent@lifestory.dev");
  await expect(menu.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(menu.getByRole("link")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();

  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
  await menuButton.click();
  await expect(menu.getByRole("link", { name: /Studio/ })).toBeVisible();
  await menu.getByRole("link", { name: /Admin/ }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(menu).toBeHidden();
  await expect(page.getByTestId("invite-family")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("an author who isn't the operator can't reach Admin", async ({ browser }) => {
  const email = `author-${unique()}@example.com`;
  const operator = await (await browser.newContext()).newPage();
  await operator.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/admin");
  const grant = operator.getByRole("form", { name: "Let someone author" });
  // The account must exist before it can author.
  const author = await (await browser.newContext()).newPage();
  await author.goto(`/__dev/log-me-in/${email}?returnTo=/`);
  await grant.getByLabel("Account email").fill(email);
  await grant.getByRole("button", { name: "Let them author" }).click();
  await expect(operator.getByRole("status")).toHaveText(`${email} can author stories now.`);
  await operator.context().close();

  await author.reload();
  await expect(author.getByRole("link", { name: "Studio" })).toBeVisible();
  await expect(author.getByRole("link", { name: "Admin" })).toHaveCount(0);
  await author.goto("/admin");
  await expect(author.getByText(/not found/i)).toBeVisible();
  await expect(author.getByTestId("authors")).toHaveCount(0);
  await author.context().close();
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("parent@lifestory.dev");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
});
