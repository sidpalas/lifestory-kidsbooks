import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { expect, test } from "@playwright/test";
import type { ServerServices, StoryPart } from "@lifestory/core";
import { Effect } from "effect";

// Part generation has no screens yet (the authoring UI will call these functions), so this drives packages/core
// directly and lets the worker Playwright starts run `part.generate` with the fake provider: the whole path from
// request to an approved part in the draft's manifest, the same way a real provider's edit goes.
const fixture = new URL("../../../fixtures/stories/moon-picnic/", import.meta.url);
const operator = "user_operator";

test("an author generates a part, reviews it on light and dark skin, and approves it into the draft", async ({ page }) => {
  // Imported here, not at the top: Playwright's runner imports every spec to list the tests, and @lifestory/core would
  // cost it ~0.2 GB for the whole run, which a 4 GB orb can't spare (AGENTS.md, "Orb size").
  const { approvedParts, Database, decodeStoryManifest, getPart, importStoryVersion, makeServerRuntime, requestPart, reviewPart, withApprovedParts } =
    await import("@lifestory/core");
  const runtime = makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  try {
    // A fresh draft story by the operator: the sample story's manifest and assets, unpublished.
    const suffix = `${Date.now()}`;
    const storyId = `story_e2e_parts_${suffix}`;
    const storyVersionId = `sv_e2e_parts_${suffix}`;
    await run(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query("insert into story (id, author_id, slug, title, summary, status) values ($1, $2, $3, 'Parts', 'e2e', 'draft')", [
            storyId,
            operator,
            `e2e-parts-${suffix}`,
          ]),
        ),
      ),
    );
    await run(
      importStoryVersion({
        id: storyVersionId,
        storyId,
        version: 1,
        manifest: JSON.parse(await readFile(new URL("manifest.json", fixture), "utf8")),
        publishedAt: null,
        readAsset: async (asset) => ({
          body: new Uint8Array(await readFile(new URL(asset, fixture))),
          contentType: { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
        }),
      }),
    );

    const request = {
      storyVersionId,
      pageId: "p01",
      slotId: "hero",
      age: "young-child",
      face: "face:round",
      axis: "hair",
      option: "hair:curly",
      zone: [250, 0, 750, 420],
    } as const;
    let part: StoryPart = await run(requestPart(operator, request));
    expect(part.status).toBe("generating");
    // Asking again is the same part, not a second generation.
    expect((await run(requestPart(operator, request))).id).toBe(part.id);
    await expect.poll(async () => (part = await run(getPart(operator, part.id))).status, { timeout: 30_000 }).toBe("pending_review");

    // One layer, the hair, recoloured by hair colour, placed inside the zone; the fake costs nothing and comes back
    // shifted by a pixel and re-toned, which the cut-out undid.
    expect(part.layers).toHaveLength(1);
    const [layer] = part.layers;
    expect(layer!.palette).toBe("hairColour");
    const [x0, y0, x1, y1] = layer!.at;
    expect(x0).toBeGreaterThanOrEqual(250);
    expect(x1).toBeLessThanOrEqual(750);
    expect(y0).toBeGreaterThanOrEqual(0);
    expect(y1).toBeLessThanOrEqual(420);
    expect(part).toMatchObject({ provider: "fake", costUsd: 0, error: null });
    expect(part.metrics).toMatchObject({ zoneEdgeContact: 0 });
    expect((part.metrics as { recompositeError: number }).recompositeError).toBeLessThan(2);

    // The author opens the layer and the review sheet; the draft's files are theirs alone.
    await page.goto("/__dev/log-me-in/operator@lifestory.dev?returnTo=/");
    for (const key of [layer!.key, part.files.sheet!, part.files.light!, part.files.dark!]) {
      const file = await page.request.get(`/api/files/${key}`);
      expect(file.status(), key).toBe(200);
      expect(file.headers()["content-type"]).toBe("image/png");
    }
    await page.goto("/__dev/log-me-in/parent@lifestory.dev?returnTo=/");
    expect((await page.request.get(`/api/files/${part.files.sheet}`)).status()).not.toBe(200);

    // Approving puts the layer into the draft's figure in place of the placeholder curls, and the manifest still validates.
    expect((await run(reviewPart(operator, part.id, "approve"))).status).toBe("approved");
    const draft = await run(
      Database.use(({ pool }) => Effect.promise(() => pool.query("select manifest from story_version where id = $1", [storyVersionId]))),
    );
    const merged = withApprovedParts(await run(decodeStoryManifest(draft.rows[0].manifest)), await run(approvedParts(operator, storyVersionId)));
    const figure = (await run(decodeStoryManifest(merged))).pages[0]!.illustration.layers.find(
      (candidate) => candidate.kind === "figure" && candidate.slotId === "hero",
    );
    const curls = figure?.kind === "figure" ? figure.parts.filter((p) => p.age === "young-child" && p.face === "face:round" && p.option === "hair:curly") : [];
    expect(curls).toEqual([{ age: "young-child", face: "face:round", axis: "hair", option: "hair:curly", asset: layer!.asset, at: layer!.at, palette: "hairColour", approved: true }]);
  } finally {
    await runtime.dispose();
  }
});
