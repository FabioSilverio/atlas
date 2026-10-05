import { db, schema } from "@/lib/db/client";
import { HERRE_CATEGORY_VALUE } from "@/lib/ideology/normalize";
import { countryMatcher } from "../lib/countries";
import { loadHerreLatest, URLS } from "../lib/datasets";
import { fetchCached } from "../lib/http";
import { parse } from "csv-parse/sync";
import { touchSource, type Job } from "../lib/job";
import { loadPartyScores } from "../lib/party-scores";
import { chunks } from "../lib/wiki";

const FROM = 2006;

/**
 * Chief executive per year, 2006–2020, from Herre (2023): who led, which party,
 * and an economic position — the party's best academic score when there is one,
 * otherwise Herre's own categorical coding. Years after 2020 come from the
 * government snapshots ATLAS takes every day.
 */
export const historyJob: Job = {
  name: "history",
  description: "chefe do executivo por ano 2006–2020 (Herre) + snapshot do ano atual",
  async run() {
    await loadHerreLatest(); // warms the cache
    const rows = parse(await fetchCached(URLS.herre, { ttlHours: 24 * 30 }), { columns: true, bom: true, relax_quotes: true }) as Record<string, string>[];
    const [match, scores] = await Promise.all([countryMatcher(), loadPartyScores()]);
    const out = new Map<string, typeof schema.executiveHistory.$inferInsert>();
    for (const r of rows) {
      const year = Number(r.year);
      if (year < FROM) continue;
      const code = match(r.country_name);
      if (!code) continue;
      const leader = r.leader || r.hog;
      const label = r.leader_ideology && r.leader_ideology !== "not applicable" ? r.leader_ideology : r.hog_ideology;
      const pf = Number(r.leader_party_id || r.hog_party_id) || null;
      const s = pf ? scores.get(pf) : undefined;
      out.set(`${code}:${year}`, {
        countryCode: code,
        year,
        leader: leader || null,
        party: r.leader_party_eng || r.leader_party || r.hog_party_eng || r.hog_party || null,
        partyfactsId: pf,
        label: label || null,
        econ: s?.econ != null ? s.econ.toFixed(3) : HERRE_CATEGORY_VALUE[label] != null ? String(HERRE_CATEGORY_VALUE[label]) : null,
        sourceId: s?.econ != null ? s.sourceId : "herre-gli",
      });
    }

    // Current year: today's derived position.
    const now = new Date().getFullYear();
    const current = (await db.execute(`
      select g.country_code, p.name as leader, gp.value_norm, gp.confidence,
             (select pa.name from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party,
             (select pa.partyfacts_id from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as pf,
             gp.derivation->'chosen'->>'sourceId' as source
      from governments g
      left join people p on p.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      left join government_positions gp on gp.government_id = g.id and gp.dimension = 'econ_lr'
      where g.ended_on is null`)) as unknown as { country_code: string; leader: string | null; value_norm: string | null; party: string | null; pf: number | null; source: string | null }[];
    for (const c of current) {
      const code = c.country_code.trim();
      out.set(`${code}:${now}`, { countryCode: code, year: now, leader: c.leader, party: c.party, partyfactsId: c.pf, label: null, econ: c.value_norm, sourceId: c.source ?? "atlas" });
    }

    const values = [...out.values()];
    await db.transaction(async (tx) => {
      await tx.delete(schema.executiveHistory);
      for (const b of chunks(values, 500)) await tx.insert(schema.executiveHistory).values(b);
    });
    await touchSource("herre-gli");
    return { rows: values.length };
  },
};
