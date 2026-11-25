// Imports a story directory (story.json, manifest.json, and the assets it names) as a published
// story owned by an existing account (docs/decisions.md D33). The development seed imports the
// sample story through it; in production, run it once inside the web container, which ships
// fixtures/stories, like operator-create.ts:
//   node packages/core/src/story-import.ts --author you@example.com fixtures/stories/moon-picnic
// Locally, `mise run story:import -- --author ... <dir>` wraps the same command and loads .env.
// Idempotent: running it again changes nothing. A story that exists with another author, or a
// version that exists with a different manifest, stops it without changing anything.
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { parseArgs } from "node:util";

import { schema } from "@lifestory/db";
import { eq } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { Database } from "./database.ts";
import { makeServerRuntime } from "./runtime.ts";
import { importStoryVersion } from "./stories.ts";

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

/**
 * Records the story, owned by `authorId`, as published, imports its manifest as version
 * `story.json#version` (validated, book format 4, assets uploaded under the story's prefix). `operatorOnly` (D60)
 * applies when the import creates the story, so a test story never reaches families; an existing story keeps its own.
 */
export const importStoryDirectory = Effect.fn("stories.importDirectory")(function* (
  dir: string,
  authorId: string,
  options: { readonly operatorOnly?: boolean } = {},
) {
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
        operatorOnly: options.operatorOnly ?? false,
      })
      .onConflictDoNothing();
    return db
      .select({ authorId: schema.story.authorId, slug: schema.story.slug, operatorOnly: schema.story.operatorOnly })
      .from(schema.story)
      .where(eq(schema.story.id, story.id));
  });
  if (!stored) return yield* Effect.die(new Error(`another story already has the slug "${story.slug}"`));
  if (stored.authorId !== authorId)
    return yield* Effect.die(new Error(`story ${story.id} already exists with another author`));
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
  });
  return { ...story, operatorOnly: stored.operatorOnly };
});

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { author: { type: "string" }, "operator-only": { type: "boolean" } },
    allowPositionals: true,
  });
  const email = values.author?.trim().toLowerCase();
  if (!email || positionals.length === 0) {
    console.error(
      "usage: node packages/core/src/story-import.ts --author <email> [--operator-only] <story directory>...",
    );
    process.exit(2);
  }
  const runtime = makeServerRuntime();
  try {
    const [author] = await runtime.runPromise(
      Database.query((db) => db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.email, email))),
    );
    if (!author) throw new Error(`no account for ${email}; create it first (operator-create.ts, or an invitation)`);
    for (const dir of positionals) {
      const story = await runtime.runPromise(
        importStoryDirectory(dir, author.id, { operatorOnly: values["operator-only"] }),
      );
      console.log(
        `${story.title} (/stories/${story.slug}) v${story.version} is published, by ${email}${story.operatorOnly ? ", for operators only" : ""}.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await runtime.dispose();
  }
}
