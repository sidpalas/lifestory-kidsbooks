import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ServerServices } from "@lifestory/core";
import { expect, test } from "@playwright/test";
import { Effect } from "effect";

import { markDrawn } from "./drawn.ts";

// Operator-only stories (D60): the operator hides a published story from families, on the server, while operators
// keep seeing and using it to try the pipeline. A fresh story each run, so the seeded ones stay as they are.
test("an operator-only story is listed, opened, drawn, and booked only by operators; families get nothing", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Imported here, not at the top (AGENTS.md, "Orb size").
  const { createBook, Database, importStoryVersion, makeServerRuntime, setStoryOperatorOnly } =
    await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const query = (text: string, values: Array<unknown>) =>
    run(Database.use(({ pool }) => Effect.promise(() => pool.query(text, values))));
  const fixture = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
  const readAsset = async (asset: string) => ({
    body: new Uint8Array(await readFile(new URL(asset, fixture))),
    contentType: { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
  });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const storyId = `story_e2e_oponly_${id}`;
  const slug = `e2e-oponly-${id}`;
  const title = `Operator Picnic ${id}`;
  const parent = "user_parent";
  const family = "org_example_family";
  const asset = `/api/files/stories/${storyId}/v1/pages/p01/plate.svg`;
  const secondOperator = `op2-${id}@lifestory.dev`;
  const cast = (name: string) =>
    ({
      hero: { name: `${name}a ${id}`, title: null, pronouns: "she/her", age: "young-child" },
      grownup: { name: `${name}b ${id}`, title: null, pronouns: "she/her", age: "adult" },
    }) as const;
  const familyOf = async (userId: string) =>
    (await query("select organization_id from member where user_id = $1 limit 1", [userId])).rows[0]
      .organization_id as string;
  const contexts = [] as Array<Awaited<ReturnType<typeof browser.newContext>>>;
  const signedIn = async (email: string, returnTo: string) => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/__dev/log-me-in/${email}?returnTo=${encodeURIComponent(returnTo)}`);
    return page;
  };
  try {
    await query(
      "insert into story (id, author_id, slug, title, summary, status, published_at) values ($1, 'user_operator', $2, $3, 'e2e', 'published', now())",
      [storyId, slug, title],
    );
    await run(
      importStoryVersion({
        id: `${storyId}_v1`,
        storyId,
        version: 1,
        manifest,
        readAsset,
        publishedAt: new Date("2026-11-19T19:00:00Z"),
      }),
    );
    // The family made a book while the story was for everyone.
    const { id: bookId } = await run(createBook(parent, family, { slug, cast: cast("A") }));
    await markDrawn(bookId);

    // 1. The operator makes it operator-only in Studio; it stays published (not a draft).
    const author = await signedIn("operator@lifestory.dev", `/author/${storyId}`);
    const visibility = author.getByTestId("story-visibility");
    await expect(visibility).toHaveAttribute("data-operator-only", "false");
    await visibility.getByRole("button", { name: "Make operator only" }).click();
    await expect(visibility).toHaveAttribute("data-operator-only", "true");
    await expect(author.getByTestId("story-catalogue")).toContainText("Published, for operators only.");
    await author.goto("/author");
    await expect(author.getByTestId("authored-stories")).toContainText("operator only: hidden from families");
    expect((await query("select status from story where id = $1", [storyId])).rows[0].status).toBe("published");

    // 2. Families: not listed, page not found, no new book (even with their book listed), and a stranger can't read
    // its files.
    const reader = await signedIn("parent@lifestory.dev", "/stories");
    await expect(reader.getByTestId("stories")).toBeVisible();
    await expect(reader.getByTestId("stories")).not.toContainText(title);
    expect((await reader.goto(`/stories/${slug}`))?.status()).toBe(404);
    await expect(run(createBook(parent, family, { slug, cast: cast("B"), existing: [bookId] }))).rejects.toMatchObject({
      _tag: "NotFound",
    });
    expect(
      (await query("select count(*)::int as n from book where story_version_id = $1", [`${storyId}_v1`])).rows[0].n,
    ).toBe(1);
    const stranger = await signedIn(`stranger-${id}@lifestory.dev`, "/");
    expect((await stranger.request.get(asset)).status()).toBe(404);
    // A signed-in non-operator can't change who sees it, even with the story's ID.
    await expect(
      run(
        setStoryOperatorOnly(
          { id: parent, name: "Parent", email: "parent@lifestory.dev", role: "user", activeFamilyId: family },
          storyId,
          false,
        ),
      ),
    ).rejects.toThrow("Only the operator");

    // 3. The book made before still opens and draws for its family, as with archiving (D49).
    await reader.goto(`/books/${bookId}`);
    await expect(reader.getByTestId("book-page").first()).toBeVisible();
    expect((await reader.request.get(asset)).status()).toBe(200);

    // 4. The author operator sees it marked in the stories, previews it, and makes a book in their own family.
    await author.goto("/stories");
    await expect(author.getByTestId("stories")).toContainText(title);
    await expect(author.getByTestId("story-operator-only").first()).toBeVisible();
    await author.goto(`/stories/${slug}`);
    await expect(author.getByTestId("story-operator-only")).toContainText("Operator only.");
    await expect(author.getByTestId("book-page").first()).toBeVisible();
    await run(createBook("user_operator", await familyOf("user_operator"), { slug, cast: cast("C") }));

    // 5. Another operator, not its author, sees and uses it too: the rule is the operator role, not authorship.
    const other = await signedIn(secondOperator, "/");
    await query(`update "user" set role = 'admin' where email = $1`, [secondOperator]);
    const otherId = (await query(`select id from "user" where email = $1`, [secondOperator])).rows[0].id as string;
    await other.goto("/stories");
    await expect(other.getByTestId("stories")).toContainText(title);
    expect((await other.goto(`/stories/${slug}`))?.status()).toBe(200);
    expect((await other.request.get(asset)).status()).toBe(200);
    await run(createBook(otherId, await familyOf(otherId), { slug, cast: cast("D") }));

    // 6. Back to everyone: families find it again.
    await author.goto(`/author/${storyId}`);
    await author.getByRole("button", { name: "Show to everyone when published" }).click();
    await expect(author.getByTestId("story-visibility")).toHaveAttribute("data-operator-only", "false");
    await reader.goto("/stories");
    await expect(reader.getByTestId("stories")).toContainText(title);
    expect((await stranger.request.get(asset)).status()).toBe(200);
  } finally {
    await query(`update "user" set role = 'user' where email = $1`, [secondOperator]).catch(() => {});
    for (const context of contexts) await context.close();
    await runtime.dispose();
  }
});
