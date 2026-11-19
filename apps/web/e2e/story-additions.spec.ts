import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { ServerServices } from "@lifestory/core";
import { Effect } from "effect";

// Story additions (D41): an option added to the vocabulary after a story was published reaches it without a new
// version. Both sample stories gained red hair through `additions/1.json`, imported by the seed.
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const evidence = async (page: Page, name: string) => {
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: `${process.env.E2E_SCREENSHOTS}/${name}.png`, fullPage: true });
};
const imagesLoaded = (page: Page) =>
  expect.poll(() => page.evaluate(() => [...document.images].filter((img) => !img.complete || img.naturalWidth === 0).length), { timeout: 30_000 }).toBe(0);

const addCharacter = async (page: Page, name: string, age: string, start: string, hairColour?: string) => {
  await page.goto("/characters/new");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Pronouns").selectOption("she/her");
  await page.getByRole("button", { name: age, exact: true }).click();
  await page.getByRole("button", { name: start, exact: true }).click();
  if (hairColour) await page.getByRole("button", { name: `${hairColour} hair colour` }).click();
  await page.getByRole("button", { name: "Add to the family" }).click();
  await expect(page.getByTestId("characters")).toContainText(name);
};

test("a red-haired child is drawn with red hair in books of both sample stories, which are still on their published versions", async ({ page }) => {
  test.setTimeout(120_000);
  const id = unique();
  const child = `Rosie ${id}`;
  const grownup = `Fern ${id}`;
  await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
  await addCharacter(page, child, "Young child", "Long blonde hair", "Red");
  await addCharacter(page, grownup, "Adult", "Long brown hair", "Red");

  for (const [slug, version, name] of [["the-paper-boat", 2, "paper-boat"], ["the-moon-picnic", 5, "moon-picnic"]] as const) {
    await page.goto(`/stories/${slug}`);
    await expect(page.getByText(`version ${version}`)).toBeVisible();
    const make = page.getByRole("form", { name: "Make our book" });
    await make.getByLabel(/The child/).selectOption({ label: child });
    await make.getByLabel(/grown-up/i).selectOption({ label: grownup });
    // The story can draw red now, so making the book warns about nothing.
    await expect(page.getByTestId(/^cast-warning-/)).toHaveCount(0);
    await make.getByRole("button", { name: "Make the book" }).click();
    await expect(page).toHaveURL(/\/books\/book_/);
    await imagesLoaded(page);
    // Nobody is left out of the pictures, and no stand-in is asked for.
    await expect(page.getByTestId("role-hero")).not.toContainText("can't draw");
    await expect(page.getByText("This book draws a stand-in")).toHaveCount(0);
    await evidence(page, `red-hair-${name}`);
  }
});

/** Every image a page draws (the book editor's page list, or a proof's print page), as object keys, sorted. */
const drawnKeys = (page: Page, scope: string) =>
  page.locator(scope).locator("img").evaluateAll((imgs) =>
    imgs.map((img) => img.getAttribute("src")!).filter((src) => src.startsWith("/api/files/stories/")).toSorted(),
  );

test("an addition draws in an existing book at once, and a proof made before it keeps drawing what it was requested with", async ({ page }) => {
  test.setTimeout(120_000);
  // Imported here, not at the top (AGENTS.md, "Orb size"). Only light calls run in this process: the web server and
  // the worker compose and recolour the pages.
  const { Auth, createBook, createCharacter, Database, importStoryVersion, makeServerRuntime, publishStoryAddition, setLookOverride } =
    await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  const fixture = new URL("../../../fixtures/stories/moon-picnic/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8"));
  const redHair = JSON.parse(await readFile(new URL("additions/1.json", fixture), "utf8"));
  const readAsset = async (asset: string) => ({
    body: new Uint8Array(await readFile(new URL(asset, fixture))),
    contentType: { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
  });
  // The addition: red hair, and softer features (D40) for the grown-up's round face on page 2, drawn here with the
  // oval base's file so the pages show the difference. Until it exists, a softer look draws the defined base there.
  const grownupFigure = manifest.pages[1].illustration.layers.find((layer: { slotId?: string }) => layer.slotId === "grownup");
  const oval = grownupFigure.bases.find((base: { age: string; face: string }) => base.age === "adult" && base.face === "face:oval");
  const roundParts = grownupFigure.parts.filter((part: { age: string; face: string }) => part.age === "adult" && part.face === "face:round");
  const addition = {
    ...redHair,
    figures: [
      {
        pageId: "p02",
        slotId: "grownup",
        bases: [{ ...oval, face: "face:round", features: "features:soft" }],
        parts: roundParts.map((part: object) => ({ ...part, features: "features:soft" })),
      },
    ],
  };
  const parent = "user_parent";
  const family = "org_example_family";
  try {
    // A published story as it stood before red hair existed: the sample's v5, without its addition. (Coverage is
    // checked against the vocabulary, which has red, so the import counts red's palette in. It's published when the
    // sample was, so the hairstyles and facial hair added since needn't be covered, D43.)
    const suffix = unique();
    const storyId = `story_e2e_additions_${suffix}`;
    const storyVersionId = `${storyId}_v1`;
    const slug = `e2e-additions-${suffix}`;
    await run(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query("insert into story (id, author_id, slug, title, summary, status, published_at) values ($1, 'user_operator', $2, 'Additions', 'e2e', 'published', now())", [
            storyId,
            slug,
          ]),
        ),
      ),
    );
    await run(importStoryVersion({ id: storyVersionId, storyId, version: 1, manifest, readAsset, publishedAt: new Date("2026-11-19T19:00:00Z"), coveredWith: [redHair] }));
    const look = { face: "face:round", features: "features:soft", skin: "skin:s2", hair: "hair:long", hairColour: "hair-colour:red", glasses: "glasses:none", facialHair: "facial-hair:none" } as const;
    const hero = await run(createCharacter(parent, family, { name: `Rosie ${suffix}`, title: null, pronouns: "she/her", look: { ...look, age: "young-child" } }));
    const grown = await run(createCharacter(parent, family, { name: `Fern ${suffix}`, title: null, pronouns: "she/her", look: { ...look, age: "adult" } }));
    const { id: bookId } = await run(createBook(parent, family, { slug, cast: { hero: hero.id, grownup: grown.id } }));
    // The story can't draw red yet, so the parent picks brown stand-ins (D28).
    for (const slotId of ["hero", "grownup"]) {
      await run(setLookOverride(parent, { bookId, slotId, override: { hairColour: "hair-colour:brown" } }));
    }

    await page.goto(`/__dev/log-me-in/parent@lifestory.dev?returnTo=/books/${bookId}`);
    const allPages = '[aria-label="All pages"]';
    await expect(page.getByText("This book draws a stand-in").first()).toBeVisible();
    await imagesLoaded(page);
    const before = await drawnKeys(page, allPages);
    const proofs = page.getByRole("region", { name: "PDF proofs" });
    await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
    await expect(proofs.getByTestId("proof")).toHaveCount(1);
    await expect(proofs.getByTestId("proof").first()).toHaveAttribute("data-status", "ready", { timeout: 60_000 });

    // The author adds red and the softer base to the published version: no new version, and the book draws both at once.
    await run(publishStoryAddition({ storyVersionId, revision: 1, addition, readAsset, createdBy: "user_operator" }));
    await page.reload();
    await expect(page.getByText("version 1")).toBeVisible();
    await expect(page.getByText("This book draws a stand-in")).toHaveCount(0);
    await expect(page.getByText(/can't draw/)).toHaveCount(0);
    await imagesLoaded(page);
    const after = await drawnKeys(page, allPages);
    expect(after).toHaveLength(before.length);
    expect(after).not.toEqual(before);
    await evidence(page, "addition-book-after");
    await proofs.getByRole("button", { name: "Make a PDF proof" }).click();
    await expect(proofs.getByTestId("proof")).toHaveCount(2);
    await expect(proofs.getByTestId("proof").first()).toHaveAttribute("data-status", "ready", { timeout: 60_000 });

    // Publishing it again changes nothing; other content under the same revision is refused.
    await run(publishStoryAddition({ storyVersionId, revision: 1, addition, readAsset, createdBy: "user_operator" }));
    const changed = structuredClone(addition);
    changed.palettes.hairColour["hair-colour:red"][1].colour = "#ff0000";
    await expect(run(publishStoryAddition({ storyVersionId, revision: 1, addition: changed, readAsset, createdBy: "user_operator" }))).rejects.toThrow(
      "already exists with different content",
    );

    // Each proof records the additions it was requested with, and its print page (what the worker prints, and would
    // print again on a retry) draws exactly what the book drew then: the first one still the brown stand-ins and the
    // defined base, though the book has moved on.
    const { rows } = await run(
      Database.use(({ pool }) =>
        Effect.promise(() => pool.query("select id, addition_revision from proof where book_id = $1 order by created_at", [bookId])),
      ),
    );
    expect(rows.map((row) => row.addition_revision)).toEqual([0, 1]);
    const printed = async (proofId: string) => {
      const token = await run(Auth.use((auth) => Effect.succeed(auth.printToken.sign(proofId))));
      await page.goto(`/print/proofs/${proofId}?token=${encodeURIComponent(token)}`);
      await imagesLoaded(page);
      return drawnKeys(page, "body");
    };
    expect(await printed(rows[0].id)).toEqual(before);
    expect(await printed(rows[1].id)).toEqual(after);
  } finally {
    await runtime.dispose();
  }
});
