// Database snapshot as one gzipped TSV per table (Postgres COPY text format).
// The hourly pipeline keeps its database as a GitHub release asset: it restores
// the snapshot into a throwaway Postgres, ingests, and exports it again.
//
//   tsx scripts/db-snapshot.ts export <dir>   # dump every table
//   tsx scripts/db-snapshot.ts import <dir>   # load into a database whose schema is already pushed
import { spawnSync, spawn } from "node:child_process";
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";
import postgres from "postgres";

const [mode, dir] = process.argv.slice(2);
if (!["export", "import"].includes(mode) || !dir) {
  console.error("uso: tsx scripts/db-snapshot.ts export|import <dir>");
  process.exit(1);
}
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ausente");
const sql = postgres(url, { max: 1, onnotice: () => {} });

async function tables(): Promise<string[]> {
  const rows = await sql<{ t: string }[]>`select tablename as t from pg_tables where schemaname = 'public' and tablename not like '\\_\\_%' order by tablename`;
  return rows.map((r) => r.t);
}

async function columns(t: string): Promise<string[]> {
  const rows = await sql<{ c: string }[]>`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${t} order by ordinal_position`;
  return rows.map((r) => r.c);
}

async function exportAll() {
  // Never overwrite a good snapshot with a broken database (a failed restore, an empty run).
  const [{ countries, thinkers }] = await sql<{ countries: number; thinkers: number }[]>`
    select (select count(*) from countries)::int as countries, (select count(*) from thinkers)::int as thinkers`;
  if (!process.env.ALLOW_SMALL_SNAPSHOT && (countries < 200 || thinkers < 1000)) throw new Error(`banco incompleto (países ${countries}, pensadores ${thinkers}): snapshot não salvo`);
  await mkdir(dir, { recursive: true });
  const allTables = await tables();
  const manifest: Record<string, string[]> = {};
  for (const t of allTables) manifest[t] = await columns(t);
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < allTables.length) {
        const t = allTables[i++];
        const cols = manifest[t];
        // A dedicated connection per COPY avoids postgres.js connection desync after large COPY streams.
        const conn = postgres(url!, { max: 1, onnotice: () => {} });
        try {
          const stream = await conn`copy ${conn(t)} (${conn(cols)}) to stdout`.readable();
          const gzip = createGzip({ level: 6 });
          const done = pipeline(gzip, createWriteStream(path.join(dir, `${t}.tsv.gz`)));
          for await (const chunk of stream) {
            if (!gzip.write(chunk)) await once(gzip, "drain");
          }
          gzip.end();
          await done;
          console.log(`exportado ${t}`);
        } finally {
          await conn.end({ timeout: 2 });
        }
      }
    }),
  );
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ at: new Date().toISOString(), tables: manifest }, null, 1));
}

async function importAll() {
  const { tables: manifest } = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as { tables: Record<string, string[]> };
  const present = new Set(await tables());
  const files = new Set(await readdir(dir));
  const hasPsql = spawnSync("psql", ["--version"], { stdio: "ignore" }).status === 0;
  for (const t of present) await sql.unsafe(`truncate "${t}" cascade`);
  for (const [t, cols] of Object.entries(manifest)) {
    if (!present.has(t) || !files.has(`${t}.tsv.gz`)) continue;
    const current = new Set(await columns(t));
    if (cols.some((c) => !current.has(c))) {
      console.warn(`pulado ${t}: colunas removidas do esquema`);
      continue;
    }
    const filePath = path.join(dir, `${t}.tsv.gz`);
    if (hasPsql) {
      const colList = cols.map((c) => `"${c}"`).join(", ");
      const child = spawn("psql", [url!, "-v", "ON_ERROR_STOP=1", "-q", "-c", `SET session_replication_role = replica; COPY "${t}" (${colList}) FROM STDIN`], {
        stdio: ["pipe", "inherit", "inherit"],
      });
      await pipeline(createReadStream(filePath), createGunzip(), child.stdin);
      const [code] = (await once(child, "exit")) as [number | null];
      if (code !== 0) throw new Error(`psql falhou em ${t} (exit ${code})`);
    } else {
      const conn = postgres(url!, { max: 1, onnotice: () => {} });
      try {
        await conn.begin(async (tx) => {
          await tx`set local session_replication_role = replica`;
          const sink = await tx`copy ${tx(t)} (${tx(cols)}) from stdin`.writable();
          const src = createReadStream(filePath).pipe(createGunzip());
          for await (const chunk of src) {
            if (!sink.write(chunk)) await once(sink, "drain");
          }
          sink.end();
          await once(sink, "finish");
        });
      } finally {
        await conn.end({ timeout: 2 });
      }
    }
    console.log(`importado ${t}`);
  }
  // Serial sequences continue after the highest id.
  const seqs = await sql<{ t: string; c: string }[]>`
    select table_name as t, column_name as c from information_schema.columns
    where table_schema = 'public' and column_default like 'nextval(%'`;
  for (const { t, c } of seqs) await sql.unsafe(`select setval(pg_get_serial_sequence('"${t}"', '${c}'), coalesce((select max("${c}") from "${t}"), 0) + 1, false)`);
}

(mode === "export" ? exportAll() : importAll())
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
