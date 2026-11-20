// Applies every migration in ../migrations, including the vendored Absurd schema.
// Safe to run repeatedly: Drizzle records applied migrations in drizzle.__drizzle_migrations.
// Safe to run concurrently (the web and worker services both run it before a release): a session advisory lock
// makes a second run wait, then find nothing left to apply. Drizzle's migrator takes no lock of its own.
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

// Any constant shared by every run; the lock lives only as long as this connection.
const MIGRATION_LOCK = 7_317_420_501;

const client = new Client({ connectionString: url });
await client.connect();
try {
  await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
  await migrate(drizzle({ client }), {
    migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)),
  });
  console.log("migrations applied");
} finally {
  await client.end();
}
