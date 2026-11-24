import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { ServerServices, SessionUser } from "@lifestory/core";
import { expect, test } from "@playwright/test";
import { Effect } from "effect";

// A story draft's revision check (D37): a save or publish made from an older revision fails with DraftChanged instead
// of overwriting a save made elsewhere; a published version can't be saved; only its author edits a draft.
const fixture = new URL("../../../fixtures/stories/kite-day/", import.meta.url);
const operator: SessionUser = {
  id: "user_operator",
  name: "Sid (operator)",
  email: "operator@lifestory.dev",
  role: "admin",
  activeFamilyId: null,
};
const parent: SessionUser = {
  id: "user_parent",
  name: "Pat Parent",
  email: "parent@lifestory.dev",
  role: "user",
  activeFamilyId: null,
};
const unique = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

test("a draft open in one tab doesn't overwrite a save made in another", async ({ page }) => {
  test.setTimeout(120_000);
  // Imported here, not at the top, so Playwright's runner doesn't load @lifestory/core to list the tests (parts.spec.ts).
  const core = await import("@lifestory/core");
  const runtime = core.makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  try {
    // A draft of the sample story by the operator.
    const suffix = unique();
    const storyId = `story_e2e_drafts_${suffix}`;
    await run(
      core.Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query(
            "insert into story (id, author_id, slug, title, summary, status) values ($1, $2, $3, 'Drafts', 'e2e', 'draft')",
            [storyId, operator.id, `e2e-drafts-${suffix}`],
          ),
        ),
      ),
    );
    await run(
      core.importStoryVersion({
        id: `sv_e2e_drafts_${suffix}`,
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
    const opened = await run(core.getDraft(operator, storyId));
    await page.goto(`/__dev/log-me-in/operator@lifestory.dev?returnTo=/author/${storyId}`);
    await expect(page.getByTestId("draft-state")).toHaveText(`Saved · revision ${opened.revision}`, {
      timeout: 30_000,
    });

    // Another tab saves the draft.
    await run(
      core.saveDraft(operator, storyId, {
        revision: opened.revision,
        draft: opened.draft,
        title: `Saved elsewhere ${suffix}`,
        summary: opened.story.summary,
      }),
    );

    // Its next save is refused rather than overwriting the other tab's.
    await page.getByLabel("Title", { exact: true }).fill(`Saved here ${suffix}`);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/This draft changed somewhere else/)).toBeVisible();
    expect((await run(core.getDraft(operator, storyId))).story.title).toBe(`Saved elsewhere ${suffix}`);
  } finally {
    await runtime.dispose();
  }
});

test("the server keeps a draft's revision check, published versions, and drafts to their author", async () => {
  const core = await import("@lifestory/core");
  const runtime = core.makeServerRuntime();
  const run = <A, E>(effect: Effect.Effect<A, E, ServerServices>) => runtime.runPromise(effect);
  // "ok", or the tag of the typed error the call fails with.
  const outcome = <A, E>(effect: Effect.Effect<A, E, ServerServices>) =>
    run(effect.pipe(Effect.match({ onSuccess: () => "ok", onFailure: (error) => (error as { _tag: string })._tag })));
  try {
    const suffix = unique();
    const { id: storyId } = await run(
      core.createStory(operator, { title: `Rules ${suffix}`, slug: `e2e-rules-${suffix}`, summary: "e2e" }),
    );
    const opened = await run(core.getDraft(operator, storyId));
    const save = (user: SessionUser, revision: number, title: string) =>
      core.saveDraft(user, storyId, {
        revision,
        draft: opened.draft,
        title,
        summary: opened.story.summary,
      });

    // Only authors edit drafts; a family's parent can't, even with the story's ID.
    expect(await outcome(save(parent, opened.revision, "Parent's"))).toBe("Forbidden");
    expect(await outcome(core.getDraft(parent, storyId))).toBe("Forbidden");
    expect(await outcome(core.publishDraft(parent, storyId, opened.revision))).toBe("Forbidden");

    // A save from the revision that was opened goes through once; a second from it, or a publish, is refused.
    expect(await outcome(save(operator, opened.revision, `First ${suffix}`))).toBe("ok");
    expect(await outcome(save(operator, opened.revision, `Stale ${suffix}`))).toBe("DraftChanged");
    expect(await outcome(core.publishDraft(operator, storyId, opened.revision))).toBe("DraftChanged");
    expect((await run(core.getDraft(operator, storyId))).story.title).toBe(`First ${suffix}`);

    // A story with only published versions has no draft to save, and its stored manifest doesn't change.
    const sample = await run(
      core.Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query(
            "select s.id, v.manifest::text as manifest from story s join story_version v on v.story_id = s.id where s.slug = 'the-kite-day' and v.published_at is not null order by v.version desc limit 1",
          ),
        ),
      ),
    );
    const { id: sampleId, manifest } = sample.rows[0] as { id: string; manifest: string };
    expect(
      await outcome(
        core.saveDraft(operator, sampleId, {
          revision: 0,
          draft: opened.draft,
          title: "Changed",
          summary: "Changed",
        }),
      ),
    ).toBe("NotFound");
    const after = await run(
      core.Database.use(({ pool }) =>
        Effect.promise(() =>
          pool.query(
            "select manifest::text as manifest from story_version where story_id = $1 and published_at is not null order by version desc limit 1",
            [sampleId],
          ),
        ),
      ),
    );
    expect(after.rows[0].manifest).toBe(manifest);
  } finally {
    await runtime.dispose();
  }
});
