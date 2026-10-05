import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

// One driver for every environment: postgres.js speaks the wire protocol to
// the local PGlite server (`npm run db`) and to Neon's pooled endpoint alike.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };

function connect() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida (veja .env.example)");
  const isLocal = /127\.0\.0\.1|localhost/.test(url);
  return postgres(url, {
    // Neon's pooler (PgBouncer, transaction mode) does not support prepared statements.
    prepare: false,
    // The local PGlite server multiplexes connections onto a single-connection
    // database and can interleave concurrent extended-protocol messages; one
    // connection per process serialises queries and avoids that.
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
