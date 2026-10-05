import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// One driver for every environment. postgres.js pipelines concurrent queries on
// a connection, which breaks behind a transaction-mode pooler (PgBouncer may
// route the Parse and Bind of one query to different server connections) and
// behind the local PGlite multiplexer. So: Neon's direct (unpooled) endpoint in
// production, and a single connection locally.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function connect() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  const pooled = /-pooler\./.test(url);
  return postgres(url, {
    prepare: !pooled && !isLocal,
    max: isLocal ? 1 : 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
}

export const pg = globalForDb.pg ?? connect();
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
export type DB = typeof db;
export { schema };
