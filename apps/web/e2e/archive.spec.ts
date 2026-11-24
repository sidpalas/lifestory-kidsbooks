import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ServerServices } from "@lifestory/core";
import { expect, test } from "@playwright/test";
import { Effect } from "effect";

// Archiving a story (D49): its author takes it out of every family's stories and stops new books of it, without
// touching the books already made, and can restore it. A fresh story each run, so the seeded ones stay published.
test("an author archives a story: families can't find it or make a book of it, existing books still draw, and restoring brings it back", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Imported here, not at the top (AGENTS.md, "Orb size").
  const { createBook, Database, importStoryVersion, makeServerRuntime } = await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const fixture = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
  const readAsset = async (asset: string) => ({
    body: new Uint8Array(await readFile(new URL(asset, fixture))),
    contentType: { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
  });
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const storyId = `story_e2e_archive_${id}`;
  const slug = `e2e-archive-${id}`;
  const title = `Archive Picnic ${id}`;
  const parent = "user_parent";
  const family = "org_example_family";
  const asset = `/api/files/stories/${storyId}/v1/pages/p01/plate.svg`;
  const contexts = [] as Array<Awaited<ReturnType<typeof browser.newContext>>>;
  const signedIn = async (email: string, returnTo: string) => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(`/__dev/log-me-in/${email}?returnTo=${encodeURIComponent(returnTo)}`);
    return page;
  };
  try {
    await run(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query(
            "insert into story (id, author_id, slug, title, summary, status, published_at) values ($1, 'user_operator', $2, $3, 'e2e', 'published', now())",
            [storyId, slug, title],
          ),
        ),
      ),
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
    const hero = {
      name: `Ada ${id}`,
      title: null,
      pronouns: "she/her",
      age: "young-child",
    } as const;
    const grown = {
      name: `Bea ${id}`,
      title: null,
      pronouns: "she/her",
      age: "adult",
    } as const;
    const cast = { hero: hero, grownup: grown };
    // The family made a book before the story was archived.
    const { id: bookId } = await run(createBook(parent, family, { slug, cast }));

    // 1. The author archives it from Studio, after confirming.
    const author = await signedIn("operator@lifestory.dev", `/author/${storyId}`);
    const catalogue = author.getByTestId("story-catalogue");
    await expect(catalogue).toHaveAttribute("data-archived", "false");
    await catalogue.getByRole("button", { name: "Archive…" }).click();
    await expect(catalogue).toContainText("Families keep the books they made");
    await catalogue.getByRole("button", { name: "Archive the story" }).click();
    await expect(catalogue).toHaveAttribute("data-archived", "true");
    await expect(catalogue.getByRole("button", { name: "Restore to families' stories" })).toBeVisible();
    await author.goto("/author");
    await expect(author.getByTestId("authored-stories")).toContainText("archived: hidden from families");

    // 2. Families: gone from the stories, its page is not found, and the server makes no book of it, even with the
    // books listed, or by its address.
    const reader = await signedIn("parent@lifestory.dev", "/stories");
    await expect(reader.getByTestId("stories")).toBeVisible();
    await expect(reader.getByTestId("stories")).not.toContainText(title);
    const storyPage = await reader.goto(`/stories/${slug}`);
    expect(storyPage?.status()).toBe(404);
    await expect(run(createBook(parent, family, { slug, cast, existing: [bookId] }))).rejects.toThrow();
    const { rows } = await run(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query("select count(*)::int as n from book where story_version_id = $1", [`${storyId}_v1`]),
        ),
      ),
    );
    expect(rows[0].n).toBe(1);

    // 3. The book made before still opens and draws, its files readable by its family.
    await reader.goto(`/books/${bookId}`);
    await expect(reader.getByTestId("book-page").first()).toBeVisible();
    await expect
      .poll(
        () =>
          reader.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length),
        { timeout: 30_000 },
      )
      .toBe(0);
    expect((await reader.request.get(asset)).status()).toBe(200);
    // Someone with no book of it can't read its files.
    const stranger = await signedIn(`stranger-${id}@lifestory.dev`, "/");
    expect((await stranger.request.get(asset)).status()).toBe(404);

    // 4. The author still previews it, told it's archived, with no way to make a book, not even on the server for
    // their own family, who can read the story.
    const { rows: own } = await run(
      Database.use(({ pool }) =>
        Effect.promise(() => pool.query("select organization_id from member where user_id = 'user_operator' limit 1")),
      ),
    );
    const ownFamily = own[0].organization_id as string;
    const ownHero = {
      name: `Cy ${id}`,
      title: null,
      pronouns: "she/her",
      age: "young-child",
    } as const;
    const ownGrown = {
      name: `Di ${id}`,
      title: null,
      pronouns: "she/her",
      age: "adult",
    } as const;
    await expect(
      run(createBook("user_operator", ownFamily, { slug, cast: { hero: ownHero, grownup: ownGrown } })),
    ).rejects.toThrow("is archived");
    await author.goto(`/stories/${slug}`);
    await expect(author.getByTestId("story-archived")).toContainText("Archived.");
    await expect(author.getByRole("button", { name: /^(Make the book|Make another copy)$/ })).toHaveCount(0);
    await expect(author.getByTestId("book-page").first()).toBeVisible();

    // 5. Restoring brings it back to families.
    await author.getByRole("link", { name: "Restore it in Studio" }).click();
    await author.getByRole("button", { name: "Restore to families' stories" }).click();
    await expect(author.getByTestId("story-catalogue")).toHaveAttribute("data-archived", "false");
    await reader.goto("/stories");
    await expect(reader.getByTestId("stories")).toContainText(title);
    expect((await stranger.request.get(asset)).status()).toBe(200);
  } finally {
    for (const context of contexts) await context.close();
    await runtime.dispose();
  }
});
