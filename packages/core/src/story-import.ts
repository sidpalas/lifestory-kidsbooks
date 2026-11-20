// Imports a story directory (story.json, manifest.json, and the assets it names) as a published
// story owned by an existing account (docs/decisions.md D33). The development seed imports the
// sample story through it; in production, run it once inside the web container, which ships
// fixtures/stories, like operator-create.ts:
//   node packages/core/src/story-import.ts --author you@example.com fixtures/stories/moon-picnic
// Locally, `mise run story:import -- --author ... <dir>` wraps the same command and loads .env.
// Idempotent: running it again changes nothing. A story that exists with another author, or a
// version that exists with a different manifest, stops it without changing anything.
import { readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { schema } from "@lifestory/db";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { Database } from "./database.ts";
import { makeServerRuntime } from "./runtime.ts";
import { importStoryVersion, publishStoryAddition } from "./stories.ts";

/** story.json: what a story directory says about the story itself; manifest.json holds the version's content. */
const StoryFile = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  summary: Schema.String,
  /** The version manifest.json is. A changed manifest needs a new number: stored versions never change. */
  version: Schema.Number,
  publishedAt: Schema.String,
});

const contentTypes: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

const readJson = (dir: string, name: string) =>
  Effect.promise(async () => JSON.parse(await readFile(resolve(dir, name), "utf8")) as unknown);

/** additions/1.json, 2.json, ... (D41), in order; a gap in the numbers is a mistake in the directory. */
const readAdditions = (dir: string) =>
  Effect.promise(async () => {
    const names = await readdir(resolve(dir, "additions")).catch(() => [] as Array<string>);
    const numbers = names
      .flatMap((name) => /^(\d+)\.json$/.exec(name)?.[1] ?? [])
      .map(Number)
      .toSorted((a, b) => a - b);
    if (numbers.some((n, i) => n !== i + 1))
      throw new Error(`${dir}/additions: expected 1.json to ${numbers.length}.json, found ${names.join(", ")}`);
    return Promise.all(
      numbers.map(async (n) => JSON.parse(await readFile(resolve(dir, "additions", `${n}.json`), "utf8")) as unknown),
    );
  });

/**
 * Records the story, owned by `authorId`, as published, imports its manifest as version
 * `story.json#version` (validated, every part approved, assets uploaded under the story's prefix), then
 * adds the version's additions from `additions/<n>.json` (D41), so new options reach a published version
 * without a new one.
 */
export const importStoryDirectory = Effect.fn("stories.importDirectory")(function* (dir: string, authorId: string) {
  const story = yield* Schema.decodeUnknownEffect(StoryFile)(yield* readJson(dir, "story.json")).pipe(Effect.orDie);
  const publishedAt = new Date(story.publishedAt);
  const [stored] = yield* Database.query(async (db) => {
    await db
      .insert(schema.story)
      .values({
        id: story.id,
        authorId,
        slug: story.slug,
        title: story.title,
        summary: story.summary,
        status: "published",
        publishedAt,
      })
      .onConflictDoNothing();
    return db
      .select({ authorId: schema.story.authorId, slug: schema.story.slug })
      .from(schema.story)
      .where(eq(schema.story.id, story.id));
  });
  if (!stored) return yield* Effect.die(new Error(`another story already has the slug "${story.slug}"`));
  if (stored.authorId !== authorId)
    return yield* Effect.die(new Error(`story ${story.id} already exists with another author`));
  const additions = yield* readAdditions(dir);
  const readAsset = async (asset: string) => ({
    body: await readFile(resolve(dir, asset)),
    contentType: contentTypes[extname(asset)] ?? "application/octet-stream",
  });
  const storyVersionId = `${story.id}_v${story.version}`;
  yield* importStoryVersion({
    id: storyVersionId,
    storyId: story.id,
    version: story.version,
    manifest: yield* readJson(dir, "manifest.json"),
    readAsset,
    publishedAt,
    coveredWith: additions,
  });
  for (const [i, addition] of additions.entries()) {
    yield* publishStoryAddition({ storyVersionId, revision: i + 1, addition, readAsset, createdBy: authorId });
  }
  return { ...story, additions: additions.length };
});

if (import.meta.main) {
  const { values, positionals } = parseArgs({ options: { author: { type: "string" } }, allowPositionals: true });
  const email = values.author?.trim().toLowerCase();
  if (!email || positionals.length === 0) {
    console.error("usage: node packages/core/src/story-import.ts --author <email> <story directory>...");
    process.exit(2);
  }
  const runtime = makeServerRuntime();
  try {
    const [author] = await runtime.runPromise(
      Database.query((db) => db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email))),
    );
    if (!author) throw new Error(`no account for ${email}; create it first (operator-create.ts, or an invitation)`);
    for (const dir of positionals) {
      const story = await runtime.runPromise(importStoryDirectory(dir, author.id));
      console.log(
        `${story.title} (/stories/${story.slug}) v${story.version} is published with ${story.additions} additions, by ${email}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}
