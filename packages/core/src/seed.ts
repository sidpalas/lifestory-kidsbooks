// Development seed data. Idempotent: every row has a fixed ID and is inserted
// with ON CONFLICT DO NOTHING, so running it again changes nothing.
//   mise run db:seed
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { schema } from "@lifestory/db";
import { Effect } from "effect";
import { ensureOwnFamily } from "./accounts.ts";
import { Database } from "./database.ts";
import { ensureDevUser } from "./dev-users.ts";
import { makeServerRuntime } from "./runtime.ts";
import { ObjectStorage } from "./storage.ts";
import { importStoryVersion } from "./stories.ts";

export const seedUsers = {
  operator: { id: "user_operator", name: "Sid (operator)", email: "operator@lifestory.dev", role: "admin" },
  parent: { id: "user_parent", name: "Pat Parent", email: "parent@lifestory.dev", role: "user" },
  grandparent: { id: "user_grandparent", name: "Gran Viewer", email: "grandparent@lifestory.dev", role: "user" },
} as const;

export const seedFamily = { id: "org_example_family", name: "The Example Family", slug: "example-family" } as const;

const sampleStoryDir = new URL("../../../fixtures/stories/moon-picnic/", import.meta.url);
const contentTypes: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export const seed = Effect.gen(function* () {
  const { db } = yield* Database;
  yield* Effect.promise(async () => {
    for (const user of Object.values(seedUsers)) await ensureDevUser(db, user);
    await db.insert(schema.organization).values(seedFamily).onConflictDoNothing();
    await db
      .insert(schema.member)
      .values([
        { id: "member_parent", organizationId: seedFamily.id, userId: seedUsers.parent.id, role: "owner" },
        { id: "member_grandparent", organizationId: seedFamily.id, userId: seedUsers.grandparent.id, role: "viewer" },
      ])
      .onConflictDoNothing();
    await db
      .insert(schema.story)
      .values({
        id: "story_moon_picnic",
        authorId: seedUsers.operator.id,
        slug: "the-moon-picnic",
        title: "The Moon Picnic",
        summary: "A family packs a picnic basket and takes a rocket to the Moon. Sample story with placeholder art.",
        status: "published",
        publishedAt: new Date("2026-11-01T00:00:00Z"),
      })
      .onConflictDoNothing();
  });
  // The operator joins no family here, so they get their own one-person family (D3).
  yield* ensureOwnFamily(seedUsers.operator.id);
  yield* ObjectStorage.use((storage) => storage.ensureBucket);
  // The sample story's pages, text, character slots, and placeholder art (fixtures/stories/moon-picnic).
  yield* importStoryVersion({
    id: "story_moon_picnic_v1",
    storyId: "story_moon_picnic",
    version: 1,
    manifest: JSON.parse(yield* Effect.promise(() => readFile(new URL("manifest.json", sampleStoryDir), "utf8"))),
    readAsset: async (asset) => ({
      body: await readFile(new URL(asset, sampleStoryDir)),
      contentType: contentTypes[extname(asset)] ?? "application/octet-stream",
    }),
    publishedAt: new Date("2026-11-01T00:00:00Z"),
  });
});

if (import.meta.main) {
  // The seed creates accounts with a published password; production gets its operator from D21's command.
  if (process.env.NODE_ENV === "production") throw new Error("refusing to run the development seed with NODE_ENV=production");
  const runtime = makeServerRuntime();
  await runtime.runPromise(seed);
  await runtime.dispose();
  console.log(`seeded: ${Object.values(seedUsers).map((u) => u.email).join(", ")}; family ${seedFamily.slug}`);
}
