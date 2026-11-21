import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ServerServices, StoryPart } from "@lifestory/core";
import { expect, test } from "@playwright/test";
import { Effect } from "effect";

// Part generation has no screens yet (the authoring UI will call these functions), so this drives packages/core
// directly and lets the worker Playwright starts run `part.generate` with the fake provider: the whole path from
// request to an approved part in the draft's manifest, the same way a real provider's edit goes.
const fixture = new URL("../../../fixtures/stories/moon-picnic/", import.meta.url);
const operator = "user_operator";

test("an author generates a part, reviews it on light and dark skin, and approves it into the draft", async ({
  page,
}) => {
  // Single, four-tile and two-tile edits all run through the real worker, sequentially on this small orb.
  test.setTimeout(180_000);
  // Imported here, not at the top: Playwright's runner imports every spec to list the tests, and @lifestory/core would
  // cost it ~0.2 GB for the whole run, which a 4 GB orb can't spare (AGENTS.md, "Orb size").
  const {
    approvedParts,
    Database,
    decodeStoryManifest,
    getPart,
    importStoryVersion,
    Jobs,
    listParts,
    makeServerRuntime,
    requestParts,
    renderProof,
    reviewPart,
    withApprovedParts,
  } = await import("@lifestory/core");
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
          pool.query(
            "insert into story (id, author_id, slug, title, summary, status) values ($1, $2, $3, 'Parts', 'e2e', 'draft')",
            [storyId, operator, `e2e-parts-${suffix}`],
          ),
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
          contentType:
            { ".svg": "image/svg+xml", ".woff2": "font/woff2" }[extname(asset)] ?? "application/octet-stream",
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
    let [part] = (await run(requestParts(operator, [request]))) as [StoryPart];
    expect(part.status).toBe("generating");
    // Asking again is the same part, not a second generation.
    expect((await run(requestParts(operator, [request])))[0]!.id).toBe(part.id);
    await expect
      .poll(async () => (part = await run(getPart(operator, part.id))).status, { timeout: 30_000 })
      .toBe("pending_review");

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
    // The edit copied the story's approved curls, the illustrator's own on the hero's round face, given as a second image.
    expect(part.metrics).toMatchObject({ zoneEdgeContact: 0, reference: "p01/hero/young-child/face:round" });
    expect(part.prompt).toContain("styled exactly like the hair in <ref_image_1>");
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
      Database.use(({ pool }) =>
        Effect.promise(() => pool.query("select manifest from story_version where id = $1", [storyVersionId])),
      ),
    );
    const merged = withApprovedParts(
      await run(decodeStoryManifest(draft.rows[0].manifest)),
      await run(approvedParts(operator, storyVersionId)),
    );
    const figure = (await run(decodeStoryManifest(merged))).pages[0]!.illustration.layers.find(
      (candidate) => candidate.kind === "figure" && candidate.slotId === "hero",
    );
    const curls =
      figure?.kind === "figure"
        ? figure.parts.filter((p) => p.age === "young-child" && p.face === "face:round" && p.option === "hair:curly")
        : [];
    expect(curls).toEqual([
      {
        age: "young-child",
        face: "face:round",
        axis: "hair",
        option: "hair:curly",
        asset: layer!.asset,
        at: layer!.at,
        palette: "hairColour",
        approved: true,
      },
    ]);

    // One option on the hero's four bases is one tiled edit (D44): each tile is cut out against its own base, inside
    // the zone, and each part costs a quarter of the edit.
    const tiled = (["young-child", "older-child"] as const).flatMap((age) =>
      (["face:round", "face:oval"] as const).map((face) => ({ ...request, age, face, option: "hair:short" })),
    );
    let parts = await run(requestParts(operator, tiled));
    expect(new Set(parts.map((p) => p.id)).size).toBe(4);
    await expect
      .poll(
        async () => (parts = await Promise.all(parts.map((p) => run(getPart(operator, p.id))))).map((p) => p.status),
        { timeout: 60_000 },
      )
      .toEqual(["pending_review", "pending_review", "pending_review", "pending_review"]);
    expect(new Set(parts.map((p) => p.files.edit)).size).toBe(1);
    expect(parts[0]!.prompt).toContain("four separate portraits");
    expect(parts[0]!.prompt).toContain("<ref_image_1>");
    expect(parts.map((p) => (p.metrics as { tile: { index: number } }).tile.index).toSorted()).toEqual([0, 1, 2, 3]);
    // Overlapping batches, even in a different order, retain the already queued parts and their single edit.
    expect((await run(requestParts(operator, tiled.toReversed()))).map((p) => p.id)).toEqual(
      parts.map((p) => p.id).toReversed(),
    );
    for (const tiledPart of parts) {
      expect(tiledPart).toMatchObject({
        provider: "fake",
        costUsd: 0,
        error: null,
        metrics: { zoneEdgeContact: 0, tile: { of: 4 }, reference: "p01/hero/young-child/face:round" },
      });
      const hair = tiledPart.layers.find((l) => l.palette === "hairColour")!;
      expect(hair.at[0]).toBeGreaterThanOrEqual(250);
      expect(hair.at[2]).toBeLessThanOrEqual(750);
      expect(hair.at[3]).toBeLessThanOrEqual(420);
    }

    // A wider zone needs larger tiles: the same four bases become two edits of two, not four low-resolution heads.
    let large = await run(
      requestParts(
        operator,
        tiled.map((r) => ({ ...r, option: "hair:long", zone: [0, 0, 1000, 600] as const })),
      ),
    );
    await expect
      .poll(
        async () => (large = await Promise.all(large.map((p) => run(getPart(operator, p.id))))).map((p) => p.status),
        { timeout: 60_000 },
      )
      .toEqual(["pending_review", "pending_review", "pending_review", "pending_review"]);
    expect(new Set(large.map((p) => p.files.edit)).size).toBe(2);
    for (const largePart of large) {
      expect(largePart.prompt).toContain("two separate portraits");
      expect(largePart.metrics).toMatchObject({ tile: { of: 2 }, reference: "p01/hero/young-child/face:round" });
      expect(largePart.layers.some((l) => l.palette === "hairColour")).toBe(true);
    }

    // A part whose task gave up reads as failed in the draft's list too, not "generating" forever. Here its row points
    // at a task that can never succeed (a proof that doesn't exist), cancelled.
    const stuck = large[0]!;
    const { taskId } = await run(
      Jobs.use((jobs) =>
        jobs.spawn(renderProof, { proofId: `proof_none-${suffix}` }, { idempotencyKey: `e2e-parts-doomed:${suffix}` }),
      ),
    );
    await run(Jobs.use((jobs) => jobs.cancel(taskId)));
    await run(
      Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query("update story_part set status = 'generating', task_id = $1 where id = $2", [taskId, stuck.id]),
        ),
      ),
    );
    const listed = (await run(listParts(operator, storyVersionId))).find((p) => p.id === stuck.id);
    expect(listed).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/^the generation task (cancelled|failed)$/),
    });
    expect((await run(getPart(operator, stuck.id))).status).toBe("failed");

    // The author draws the hero's hair region (D56) in the editor, the left half of the zone, and saves it: the part
    // each cell shows (the approved curls, the newest short and long, the failed one with an edit) is cut out again
    // from the edit it has, at no cost, with nothing right of the region, and waits for review again.
    const shown = [part, ...parts, ...large];
    await page.goto(`/__dev/log-me-in/operator@lifestory.dev?returnTo=/author/${storyId}`);
    await page.getByRole("tab", { name: "Pages", exact: true }).click();
    const editor = page.getByTestId("figure-hero").getByTestId("region-editor");
    const canvas = editor.getByTestId("region-canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    for (const [x, y] of [
      [250, 2],
      [500, 2],
      [500, 420],
      [250, 420],
    ] as const)
      await page.mouse.click(box.x + (x / 1000) * box.width, box.y + (y / 1000) * box.height);
    await expect(editor.getByTestId("region-state")).toHaveText("4 points, not saved");
    await editor.getByRole("button", { name: `Save region and re-cut ${shown.length} parts` }).click();
    let recut: Array<StoryPart> = [];
    await expect
      .poll(
        async () => (recut = await Promise.all(shown.map((p) => run(getPart(operator, p.id))))).map((p) => p.status),
        { timeout: 60_000 },
      )
      .toEqual(shown.map(() => "pending_review"));
    await expect(editor.getByTestId("region-state")).toHaveText("4 points, saved");
    for (const [i, after] of recut.entries()) {
      const before = shown[i]!;
      expect(after).toMatchObject({ status: "pending_review", costUsd: 0, files: { edit: before.files.edit } });
      expect(after.region).toHaveLength(4);
      const hair = after.layers.find((l) => l.palette === "hairColour")!;
      expect(hair.key).not.toBe(before.layers.find((l) => l.palette === "hairColour")?.key);
      // The region's right edge is x = 500; alphaBounds keeps a margin of a couple of pixels past the last one.
      expect(hair.at[2]).toBeLessThanOrEqual(515);
    }
  } finally {
    await runtime.dispose();
  }
});
