import crosswalkSeed from "@/data/seed/party-crosswalk.json";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { loadPartyFactsCore, loadPartyFactsExternal } from "../lib/datasets";
import { fetchJson } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { norm, wikiKey } from "../lib/text";

type Crosswalk = Record<
  string,
  { partyfacts_id: number | null; ches_id?: number; gps_id?: number; parlgov_id?: number; note: string }
>;

/** Titles that redirect to an English Wikipedia article (Party Facts often stores an old title). */
async function redirectsTo(enwiki: string): Promise<string[]> {
  const title = decodeURIComponent(enwiki.split("/wiki/")[1] ?? "");
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=redirects&rdlimit=max&titles=${encodeURIComponent(title)}`;
  type R = { query?: { pages?: Record<string, { redirects?: { title: string }[] }> } };
  const json = await fetchJson<R>(url, { ttlHours: 24 * 30 });
  return Object.values(json.query?.pages ?? {}).flatMap((p) => p.redirects?.map((r) => r.title) ?? []);
}

/**
 * Links Wikidata parties to Party Facts, the hub that maps every academic
 * dataset (ParlGov, CHES, GPS, V-Party, MARPOR…) to a single party id.
 * Match order: manual crosswalk → English Wikipedia article → country + name/abbreviation.
 */
export const partiesJob: Job = {
  name: "parties",
  description: "Wikidata ↔ Party Facts (crosswalk para ParlGov, CHES, GPS, V-Party, MARPOR)",
  async run() {
    const [core, external] = await Promise.all([loadPartyFactsCore(), loadPartyFactsExternal()]);
    const crosswalk = crosswalkSeed as unknown as Crosswalk;

    const byWiki = new Map<string, number>();
    const byName = new Map<string, number[]>(); // `${country}|${normalized name}`
    const addName = (country: string, name: string | undefined, id: number) => {
      const k = norm(name);
      if (!k) return;
      const key = `${country}|${k}`;
      byName.set(key, [...(byName.get(key) ?? []), id]);
    };
    for (const r of core) {
      const id = Number(r.partyfacts_id);
      const wk = wikiKey(r.wikipedia);
      if (wk) byWiki.set(wk, id);
      addName(r.country, r.name_short, id);
      addName(r.country, r.name, id);
      addName(r.country, r.name_english, id);
      for (const alt of (r.name_other ?? "").split("/")) addName(r.country, alt.replace(/^[^:]+:\s*/, ""), id);
    }
    // Wikipedia links recorded on the external rows too (dataset_key = wikipedia carries no URL, so core is enough).

    const ext = new Map<number, Record<string, number>>();
    for (const r of external) {
      const pf = Number(r.partyfacts_id);
      if (!pf) continue;
      const e = ext.get(pf) ?? {};
      if (!(r.dataset_key in e)) e[r.dataset_key] = Number(r.dataset_party_id);
      ext.set(pf, e);
    }

    const parties = await db.select().from(schema.parties);
    const assigned = new Map<number, number>(); // partyfacts_id → our party id
    for (const p of parties) if (p.partyfactsId) assigned.set(p.partyfactsId, p.id);

    const stats = { parties: parties.length, crosswalk: 0, wikipedia: 0, name: 0, unmatched: 0, ambiguous: 0 };
    const unmatchedLeaders: string[] = [];
    const leaderIds = new Set(
      (await db.select({ id: schema.governmentParties.partyId }).from(schema.governmentParties).where(eq(schema.governmentParties.role, "leader"))).map((r) => r.id),
    );

    for (const p of parties) {
      let pf: number | null | undefined;
      let how: keyof typeof stats | null = null;
      const cw = p.wikidataQid ? crosswalk[p.wikidataQid] : undefined;
      if (cw) {
        pf = cw.partyfacts_id;
        how = "crosswalk";
      } else {
        const wk = wikiKey(p.enwiki);
        if (wk && byWiki.has(wk)) {
          pf = byWiki.get(wk);
          how = "wikipedia";
        } else if (wk && p.enwiki && (pf = (await redirectsTo(p.enwiki)).map((t) => byWiki.get(wikiKey(t)!)).find(Boolean))) {
          how = "wikipedia";
        } else if (p.countryCode) {
          const candidates = new Set<number>();
          for (const n of [p.abbrev, p.nameEn, p.name]) {
            for (const id of byName.get(`${p.countryCode}|${norm(n)}`) ?? []) candidates.add(id);
          }
          if (candidates.size === 1) {
            pf = [...candidates][0];
            how = "name";
          } else if (candidates.size > 1) {
            stats.ambiguous++;
            log.warn(`ambíguo: ${p.countryCode} ${p.name} → Party Facts ${[...candidates].join(", ")}`);
          }
        }
      }

      // Direct dataset ids from the crosswalk win over Party Facts' (which may not know a new party yet).
      const direct = { ches: cw?.ches_id, gps: cw?.gps_id, parlgov: cw?.parlgov_id };
      if (!pf && (direct.ches || direct.gps || direct.parlgov)) {
        stats.crosswalk++;
        await db
          .update(schema.parties)
          .set({ partyfactsId: null, chesId: direct.ches ?? null, gpsId: direct.gps ?? null, parlgovId: direct.parlgov ?? null, updatedAt: sql`now()` })
          .where(eq(schema.parties.id, p.id));
        continue;
      }
      if (!pf) {
        stats.unmatched++;
        if (leaderIds.has(p.id)) unmatchedLeaders.push(`${p.countryCode} ${p.name} (${p.wikidataQid})`);
        continue;
      }
      const owner = assigned.get(pf);
      if (owner && owner !== p.id) {
        log.warn(`Party Facts ${pf} já ligado a outro partido; ignorando ${p.name} (${p.wikidataQid})`);
        stats.unmatched++;
        continue;
      }
      assigned.set(pf, p.id);
      stats[how!]++;
      const e = ext.get(pf) ?? {};
      await db
        .update(schema.parties)
        .set({
          partyfactsId: pf,
          parlgovId: direct.parlgov ?? e.parlgov ?? null,
          chesId: direct.ches ?? e.ches ?? null,
          gpsId: direct.gps ?? e.gps ?? null,
          vpartyId: e.vparty ?? null,
          marporId: e.manifesto ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(schema.parties.id, p.id));
    }

    if (unmatchedLeaders.length) {
      log.warn(`${unmatchedLeaders.length} partidos de chefes do executivo sem Party Facts (adicione em data/seed/party-crosswalk.json):`);
      for (const u of unmatchedLeaders) log.warn("  ", u);
    }
    await touchSource("partyfacts");
    return { ...stats, unmatchedChiefParties: unmatchedLeaders.length };
  },
};
