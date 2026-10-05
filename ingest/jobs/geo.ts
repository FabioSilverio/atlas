import { mkdir, writeFile } from "node:fs/promises";
import disputedSeed from "@/data/seed/disputed.json";
import { sql } from "drizzle-orm";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { topology } from "topojson-server";
import { presimplify, quantile, simplify } from "topojson-simplify";
import { quantize } from "topojson-client";
import { db, schema } from "@/lib/db/client";
import { fetchJson } from "../lib/http";
import { qid, sparql } from "../lib/sparql";
import { touchSource, type Job } from "../lib/job";

const NE_URL =
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson";

type NEProps = Record<string, string | number>;

// Natural Earth points some features at a broader Wikidata item.
const QID_FIX: Record<string, string> = { Q23792: "Q219060" /* Palestinian territories → State of Palestine */ };

/** Brazilian Portuguese names from Wikidata (pt-br, then pt); Natural Earth's NAME_PT is European Portuguese. */
async function ptBrNames(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 120) {
    const values = qids.slice(i, i + 120).map((q) => `wd:${q}`).join(" ");
    const rows = await sparql(
      `SELECT ?c ?br ?pt WHERE {
        VALUES ?c { ${values} }
        OPTIONAL { ?c rdfs:label ?br FILTER(LANG(?br) = "pt-br") }
        OPTIONAL { ?c rdfs:label ?pt FILTER(LANG(?pt) = "pt") }
      }`,
      { ttlHours: 24 * 30 },
    );
    for (const r of rows) if (r.br || r.pt) out.set(qid(r.c)!, r.br || r.pt);
  }
  return out;
}

const valid = (c: string | number | undefined) => typeof c === "string" && c !== "-99" && c.length === 3;

/** Stable ATLAS code: ISO alpha-3 when it exists, else Natural Earth's ADM0_A3. */
export function atlasCode(p: NEProps, used: Set<string>): string {
  if (p.ADM0_A3 === "KOS") return "XKX"; // de facto code (World Bank, EU)
  for (const c of [p.ISO_A3, p.ISO_A3_EH, p.ADM0_A3]) {
    if (valid(c) && !used.has(c as string)) return c as string;
  }
  throw new Error(`sem código para ${p.ADMIN}`);
}

export const geoJob: Job = {
  name: "geo",
  description: "Natural Earth 1:50m → public/geo/countries.topo.json + tabela countries",
  async run() {
    const ne = await fetchJson<FeatureCollection<Geometry, NEProps>>(NE_URL, { ttlHours: 24 * 30 });
    const disputed = disputedSeed as Record<string, string>;

    // Main territories first so that e.g. Australia keeps AUS and its dependencies fall back to ADM0_A3.
    const features = [...ne.features].sort(
      (a, b) => Number(a.properties.ISO_A3 === "-99") - Number(b.properties.ISO_A3 === "-99"),
    );
    const ptbr = await ptBrNames(features.map((f) => QID_FIX[f.properties.WIKIDATAID as string] ?? (f.properties.WIKIDATAID as string)).filter(Boolean));
    const used = new Set<string>();
    const out: Feature<Geometry, Record<string, string | number>>[] = [];
    const rows: (typeof schema.countries.$inferInsert)[] = [];

    for (const f of features) {
      const p = f.properties;
      const code = atlasCode(p, used);
      used.add(code);
      const iso2 = [p.ISO_A2_EH, p.ISO_A2].find((c) => typeof c === "string" && /^[A-Z]{2}$/.test(c)) as string | undefined;
      const wd = QID_FIX[p.WIKIDATAID as string] ?? ((p.WIKIDATAID as string) || null);
      const namePt = (wd && ptbr.get(wd)) || String(p.NAME_PT || p.NAME || p.ADMIN);
      out.push({
        type: "Feature",
        id: code,
        geometry: f.geometry,
        // Keep properties minimal: the client joins everything else by code.
        properties: { n: namePt, lx: Number(p.LABEL_X), ly: Number(p.LABEL_Y), lr: Number(p.LABELRANK) },
      });
      const sov = String(p.SOV_A3);
      rows.push({
        code,
        iso2: code === "XKX" ? "XK" : (iso2 ?? null),
        wikidataQid: wd,
        namePt,
        nameEn: String(p.NAME_EN || p.ADMIN),
        continent: String(p.CONTINENT),
        region: String(p.REGION_UN),
        subregion: String(p.SUBREGION),
        neType: String(p.TYPE),
        sovereignCode: sov.length === 3 && !/\d/.test(sov) ? sov : null,
        isDisputed: code in disputed,
        disputeNote: disputed[code] ?? null,
        population: p.POP_EST ? String(p.POP_EST) : null,
        sourceId: "natural-earth",
        sourceUrl: NE_URL,
        updatedAt: new Date(),
      });
    }

    // Topology: shared borders become arcs. Keep the most significant half of the
    // vertices (Visvalingam), drop the weight coordinate, then quantize:
    // ~420 KB raw, ~145 KB gzipped.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let topo: any = topology({ countries: { type: "FeatureCollection", features: out } as never });
    topo = presimplify(topo);
    topo = simplify(topo, quantile(topo, 0.5));
    topo.arcs = topo.arcs.map((arc: number[][]) => arc.map((pt) => [pt[0], pt[1]]));
    topo = quantize(topo, 1e5);
    await mkdir("public/geo", { recursive: true });
    const json = JSON.stringify(topo);
    await writeFile("public/geo/countries.topo.json", json);

    for (let i = 0; i < rows.length; i += 100) {
      await db
        .insert(schema.countries)
        .values(rows.slice(i, i + 100))
        .onConflictDoUpdate({
          target: schema.countries.code,
          set: {
            iso2: sql`excluded.iso2`,
            wikidataQid: sql`excluded.wikidata_qid`,
            namePt: sql`excluded.name_pt`,
            nameEn: sql`excluded.name_en`,
            continent: sql`excluded.continent`,
            region: sql`excluded.region`,
            subregion: sql`excluded.subregion`,
            neType: sql`excluded.ne_type`,
            sovereignCode: sql`excluded.sovereign_code`,
            isDisputed: sql`excluded.is_disputed`,
            disputeNote: sql`excluded.dispute_note`,
            population: sql`excluded.population`,
            sourceId: sql`excluded.source_id`,
            sourceUrl: sql`excluded.source_url`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    await touchSource("natural-earth");
    return { countries: rows.length, topoKB: Math.round(json.length / 1024) };
  },
};

// Used by tests and by other jobs that need NE names for matching.
export async function loadNeNames(): Promise<Map<string, string>> {
  const ne = await fetchJson<FeatureCollection<Geometry, NEProps>>(NE_URL, { ttlHours: 24 * 30 });
  const map = new Map<string, string>();
  const rows = await db.select({ code: schema.countries.code, qid: schema.countries.wikidataQid }).from(schema.countries);
  const byQid = new Map(rows.map((r) => [r.qid, r.code]));
  for (const f of ne.features) {
    const p = f.properties;
    const code = byQid.get(p.WIKIDATAID as string);
    if (!code) continue;
    for (const k of ["ADMIN", "NAME", "NAME_LONG", "FORMAL_EN", "NAME_EN", "NAME_SORT", "NAME_ALT", "GEOUNIT", "BRK_NAME", "NAME_CIAWF"]) {
      if (p[k]) map.set(String(p[k]), code);
    }
  }
  return map;
}
