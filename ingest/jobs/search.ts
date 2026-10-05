import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Job } from "../lib/job";
import { norm } from "../lib/text";
import { chunks } from "../lib/wiki";

type Row = typeof schema.searchIndex.$inferInsert;
const q = async <T,>(query: string) => (await db.execute(query)) as unknown as T[];

/**
 * Rebuilds the global search index. Text search over accent-free text, with a
 * per-kind weight; the haystack includes alternate names (English, descriptions,
 * occupations) so "economista brasileiro" or "populismo" find the right rows.
 */
export const searchJob: Job = {
  name: "search",
  description: "índice da busca global (países, pessoas, pensadores, partidos, ideologias, temas, eleições)",
  async run() {
    const rows: Row[] = [];
    const add = (kind: string, ref: string, title: string, subtitle: string | null, url: string, weight: number, extra: (string | null | undefined)[] = [], countryCode: string | null = null) =>
      rows.push({ kind, ref, title, subtitle, url, weight: String(weight), countryCode, norm: norm([title, subtitle, ...extra].filter(Boolean).join(" ")) });

    for (const c of await q<{ code: string; name_pt: string; name_en: string; chief: string | null; party: string | null; pop: string | null }>(`
      select c.code, c.name_pt, c.name_en, pe.name as chief, c.population as pop,
        (select pa.name from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party
      from countries c left join governments g on g.country_code = c.code and g.ended_on is null
      left join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end`)) {
      const code = c.code.trim();
      add("country", code, c.name_pt, [c.chief, c.party].filter(Boolean).join(" · ") || null, `/?pais=${code}`, 1000 + Math.log10(Number(c.pop) || 1) * 10, [c.name_en, code], code);
    }
    for (const p of await q<{ qid: string; name: string; code: string; role: string; country: string }>(`
      select pe.wikidata_qid as qid, pe.name, g.country_code as code, c.name_pt as country,
        case when pe.id = g.head_of_state_id and pe.id = g.head_of_government_id then 'Chefe de Estado e de governo'
             when pe.id = g.head_of_state_id then 'Chefe de Estado' else 'Chefe de governo' end as role
      from governments g join people pe on pe.id in (g.head_of_state_id, g.head_of_government_id) join countries c on c.code = g.country_code
      where g.ended_on is null`)) {
      if (p.qid) add("person", p.qid, p.name, `${p.role} · ${p.country}`, `/?pais=${p.code.trim()}`, 600, [], p.code.trim());
    }
    for (const t of await q<{ qid: string; name: string; description: string | null; country: string | null; sitelinks: number; occ: string | null; fields: string | null }>(`
      select pe.wikidata_qid as qid, pe.name, t.description, t.primary_country as country, t.sitelinks,
        (select string_agg(x->>'label', ' ') from jsonb_array_elements(t.occupations) x) as occ,
        (select string_agg(x->>'label', ' ') from jsonb_array_elements(t.fields) x) as fields
      from thinkers t join people pe on pe.id = t.person_id`)) {
      add("thinker", t.qid, t.name, t.description, `/pensador/${t.qid}`, 300 + t.sitelinks, [t.occ, t.fields], t.country?.trim() ?? null);
    }
    for (const p of await q<{ id: number; name: string; name_en: string | null; abbrev: string | null; code: string | null; country: string | null }>(`
      select pa.id, pa.name, pa.name_en, pa.abbrev, pa.country_code as code, c.name_pt as country from parties pa left join countries c on c.code = pa.country_code`)) {
      add("party", String(p.id), p.name, [p.abbrev, p.country].filter(Boolean).join(" · ") || null, p.code ? `/?pais=${p.code.trim()}` : "/", 400, [p.name_en], p.code?.trim() ?? null);
    }
    for (const i of await q<{ qid: string; name: string; name_en: string | null; description: string | null; parties: number; thinkers: number }>(`
      select i.qid, i.name, i.name_en, i.description,
        (select count(*)::int from party_ideologies x where x.ideology_qid = i.qid) as parties,
        (select count(*)::int from thinker_ideologies x where x.ideology_qid = i.qid) as thinkers
      from ideologies i`)) {
      if (!i.parties && !i.thinkers) continue;
      add("ideology", i.qid, i.name, i.description, `/ideologia/${i.qid}`, 500 + i.parties * 3 + i.thinkers, [i.name_en]);
    }
    for (const t of await q<{ country_code: string; theme: string; recent: number; trend: string; country: string | null }>(`
      select t.country_code, t.theme, t.recent, t.trend, c.name_pt as country from theme_trends t left join countries c on c.code = t.country_code where t.country_code <> 'WLD'`)) {
      const code = t.country_code.trim();
      add("theme", `${code}:${norm(t.theme)}`, t.theme, `Tema ${t.trend === "rising" ? "em alta" : "em debate"} · ${t.country ?? code}`, `/?pais=${code}&camada=themes`, 200 + t.recent * 5, [], code);
    }
    for (const e of await q<{ id: number; code: string; date: string; kind: string; body: string; country: string }>(`
      select e.id, e.country_code as code, e.date, e.kind, e.body, c.name_pt as country from elections e join countries c on c.code = e.country_code where e.date > now() - interval '6 years'`)) {
      const year = new Date(e.date).getFullYear();
      add("election", String(e.id), `${e.country}: ${e.kind === "presidential" ? "eleição presidencial" : e.body} ${year}`, new Date(e.date).toISOString().slice(0, 10), `/?pais=${e.code.trim()}&camada=elections`, 150 + (year - 2000) * 5, ["eleicao", "eleicoes", "election"], e.code.trim());
    }
    for (const l of await q<{ id: number; name: string; year: number; category: string; code: string | null }>(`
      select l.id, l.name, min(p.year) as year, min(p.category) as category,
        (select country_code from nobel_laureate_countries x where x.laureate_id = l.id and x.relation in ('birth','org_seat') limit 1) as code
      from nobel_laureates l join nobel_prizes p on p.laureate_id = l.id group by l.id, l.name`)) {
      add("laureate", String(l.id), l.name, `Nobel ${l.year}`, `https://www.nobelprize.org/laureate/${l.id}`, 250, ["nobel", l.category], l.code?.trim() ?? null);
    }
    for (const g of await q<{ code: string; affiliated: { qid: string; name: string; description: string | null }[]; shared_ideology: { qid: string; name: string; description: string | null }[] }>(`
      select country_code as code, affiliated, shared_ideology from government_context`)) {
      for (const p of [...(g.affiliated ?? []), ...(g.shared_ideology ?? [])]) {
        add("person", p.qid, p.name, p.description, `https://www.wikidata.org/wiki/${p.qid}`, 350, [], g.code.trim());
      }
    }

    // De-duplicate on (kind, ref): first one wins.
    const seen = new Set<string>();
    const unique = rows.filter((r) => {
      const k = `${r.kind}:${r.ref}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from search_index`);
      for (const b of chunks(unique, 500)) await tx.insert(schema.searchIndex).values(b);
    });
    return { rows: unique.length };
  },
};
