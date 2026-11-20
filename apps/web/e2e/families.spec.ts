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

const inviteMember = async (page: Page, email: string, role: "Viewer (read only)" | "Parent (can edit)") => {
  const form = page.getByRole("form", { name: "Invite a family member" });
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
  await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/author");
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
  await page.goto("/family");
  await expect(page.getByTestId("members")).toContainText("Owner");

  // The link works once.
  await page.goto(setPasswordPath);
  await expect(page.getByText("This link has expired")).toBeVisible();

  // The owner invites a grandparent with the view-only role.
  await page.goto("/family");
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
  await page.goto("/family");
  await expect(page.getByTestId("family-panel")).toContainText("You're a viewer: you can read this family's books");
  await expect(page.getByRole("form", { name: "Invite a family member" })).toHaveCount(0);

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
  await page.goto("/family");
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
  await signOut(page);
  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/`);
  await expect(page.getByTestId("families")).toHaveText(`alex-${id}'s family`);
  await page.goto("/family");
  await inviteMember(page, friendEmail, "Parent (can edit)");
  await signOut(page);

  // The friend, who already has an account, accepts: the new family joins theirs and becomes active.
  const invitationPath = await emailedLink(page, friendEmail);
  await page.goto(`/__dev/log-me-in/${friendEmail}?returnTo=${encodeURIComponent(invitationPath)}`);
  await expect(page.getByText(`Join alex-${id}'s family`)).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  const switcher = page.getByRole("combobox", { name: "Family" });
  await expect(switcher.locator("option:checked")).toHaveText(`alex-${id}'s family`);
  await page.goto("/family");
  await expect(page.getByTestId("family-panel")).toContainText("You're the family's parent");
  await expect(page.getByTestId("member").filter({ hasText: ownerEmail })).toHaveText(`alex-${id}${ownerEmail}Owner`);

  // Switching back shows their own family, and the choice sticks across reloads.
  await switcher.selectOption({ label: `sam-${id}'s family` });
  await expect(page.getByTestId("family-panel")).toContainText("You're the family's owner");
  await page.reload();
  await expect(switcher.locator("option:checked")).toHaveText(`sam-${id}'s family`);
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

  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/family`);
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
  await page.goto("/family");
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
  await page.goto(`/__dev/log-me-in/${ownerEmail}?returnTo=/family`);
  await inviteMember(page, cousinEmail, "Parent (can edit)");
  await inviteMember(page, longEmail, "Viewer (read only)");
  await signOut(page);

  // The cousin joins with their email as their name: the row shows it once, not "email (email)".
  await page.goto(await emailedLink(page, cousinEmail));
  await page.getByLabel("Your name").fill(cousinEmail);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Repeat the password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account and join" }).click();
  await expect(page.getByTestId("signed-in-as")).toContainText(cousinEmail);
  await page.goto("/family");
  await expect(page.getByTestId("member").filter({ hasText: cousinEmail })).toHaveText(`${cousinEmail}Parent`);
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

test("only the operator sees Studio and the new-family invite", async ({ page }) => {
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await expect(page.getByTestId("signed-in-as")).toBeVisible();
  await expect(page.getByRole("link", { name: "Studio" })).toHaveCount(0);
  await page.goto("/author");
  await expect(page.getByTestId("not-an-author")).toBeVisible();
  await expect(page.getByTestId("invite-family")).toHaveCount(0);
});

test("a wrong password is refused", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill("parent@lifestory.dev");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("That email and password don't match.");
});
