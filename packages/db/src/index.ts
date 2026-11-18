import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import * as schema from "./schema/index.ts";

export { schema };
export type Db = NodePgDatabase<typeof schema>;

export const createDb = (pool: Pool): Db => drizzle({ client: pool, schema });
