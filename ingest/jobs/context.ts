import { db, schema } from "@/lib/db/client";
import type { ContextPerson } from "@/lib/db/schema";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { qid, sparql } from "../lib/sparql";
import { chunks, wikiExtracts, wikiTitle } from "../lib/wiki";

// "Intellectual" by Wikidata occupation (English labels, whole words).
// Core: the reason someone belongs on this list. Weak: counts only for people who
// are neither career politicians nor entertainers/athletes ("screenwriter" is not
// "writer"; a cyclist with a podcast is not a pundit).
const CORE = /\b(pundit|political commentator|commentator|columnist|opinion journalist|political theorist|theorist|ideologue|philosopher|economist|political scientist|sociologist|historian|essayist|intellectual|theologian|political strategist|strategist)\b/i;
const WEAK = /^(writer|author|novelist|journalist|blogger|podcaster|activist|academic|university teacher|professor|political adviser|radio personality)$/i;
const POLITICIAN = /\b(politician|legislator|diplomat|head of state|minister|mayor|president|judge|jurist|magistrate|military officer)\b/i;
const ENTERTAINMENT = /\b(actor|actress|singer|musician|rapper|comedian|film director|screenwriter|producer|model|socialite|athlete|cyclist|football|basketball|baseball|boxer|wrestler|wrestling|promoter|racing driver|tennis|astronaut|chef|influencer|youtuber|television personality|reality)\b/i;
const isIntellectual = (occs: string[]) =>
  occs.some((o) => CORE.test(o)) ||
  (occs.some((o) => WEAK.test(o.trim())) && !occs.some((o) => POLITICIAN.test(o)) && !occs.some((o) => ENTERTAINMENT.test(o)));
const MAX = 12;

/** Runs fn over items with at most n in flight. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

type Raw = { qid: string; name: string; description: string | null; image: string | null; sl: number; occs: Set<string>; shared: Set<string> };

/** Occupations, descriptions and images for a set of people (pt labels, en occupations for filtering). */
async function enrich(people: Map<string, Raw>) {
  for (const batch of chunks([...people.keys()], 150)) {
    const rows = await sparql(
      `SELECT ?p ?pt ?en ?dpt ?den ?img ?occLabel WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
        OPTIONAL { ?p rdfs:label ?pt FILTER(LANG(?pt) = "pt") } OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) IN ("en", "mul")) }
        OPTIONAL { ?p schema:description ?dpt FILTER(LANG(?dpt) = "pt") } OPTIONAL { ?p schema:description ?den FILTER(LANG(?den) = "en") }
        OPTIONAL { ?p wdt:P18 ?img } OPTIONAL { ?p wdt:P106 ?occ }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". } }`,
      { ttlHours: 24 * 14 },
    );
    for (const r of rows) {
      const p = people.get(qid(r.p)!)!;
      p.name = r.pt ?? r.en ?? p.name;
      p.description ??= r.dpt ?? r.den ?? null;
      p.image ??= r.img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${r.img.split("/").pop()}?width=120` : null;
      if (r.occLabel && !/^Q\d+$/.test(r.occLabel)) p.occs.add(r.occLabel);
    }
  }
}

function leaderBio(
  b: { desc?: string; img?: string; birth?: string; ptwiki?: string; enwiki?: string; occs: Set<string> } | undefined,
  pt: Map<string, { extract: string; url: string }>,
  en: Map<string, { extract: string; url: string }>,
) {
  if (!b) return {};
  const ex = b.ptwiki ? pt.get(wikiTitle(b.ptwiki)) : b.enwiki ? en.get(wikiTitle(b.enwiki)) : undefined;
  return {
    description: b.desc ?? null,
    imageUrl: b.img ?? null,
    birthYear: b.birth && /^\d{4}/.test(b.birth) ? Number(b.birth.slice(0, 4)) : null,
    occupations: [...b.occs].slice(0, 6),
    summary: ex?.extract ?? null,
    summaryUrl: ex?.url ?? null,
  };
}

const toPerson = (r: Raw): ContextPerson => ({
  qid: r.qid,
  name: r.name,
  description: r.description,
  occupations: [...r.occs].slice(0, 5),
  imageUrl: r.image,
  sitelinks: r.sl,
  ...(r.shared.size ? { shared: [...r.shared] } : {}),
});

export const contextJob: Job = {
  name: "context",
  description: "governo em contexto: história do partido no poder, ideais e intelectuais ligados (Wikidata)",
  async run() {
    const govs = (await db.execute(`
      select g.country_code, c.wikidata_qid as country_qid,
             pe.wikidata_qid as leader_qid, pe.name as leader_name,
             hs.wikidata_qid as hos_qid, hg.wikidata_qid as hog_qid,
             (select pa.wikidata_qid from government_parties x join parties pa on pa.id = x.party_id
               where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_qid,
             (select pa.name from government_parties x join parties pa on pa.id = x.party_id
               where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_name
      from governments g
      join countries c on c.code = g.country_code
      left join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
      left join people hs on hs.id = g.head_of_state_id
      left join people hg on hg.id = g.head_of_government_id
      where g.ended_on is null`)) as unknown as {
      country_code: string; country_qid: string | null; leader_qid: string | null; leader_name: string | null;
      hos_qid: string | null; hog_qid: string | null; party_qid: string | null; party_name: string | null;
    }[];

    // 1. Party facts.
    const partyQids = [...new Set(govs.map((g) => g.party_qid).filter(Boolean) as string[])];
    type PartyFacts = { founded: string | null; founders: Set<string>; chair: string | null; alignment: Set<string>; ideologies: Map<string, string>; ptwiki?: string; enwiki?: string };
    const party = new Map<string, PartyFacts>();
    for (const batch of chunks(partyQids, 100)) {
      const rows = await sparql(
        `SELECT ?p ?inc ?fLabel ?chLabel ?alLabel ?i ?iLabel ?ptwiki ?enwiki WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
          OPTIONAL { ?p wdt:P571 ?inc } OPTIONAL { ?p wdt:P112 ?f } OPTIONAL { ?p wdt:P488 ?ch }
          OPTIONAL { ?p wdt:P1387 ?al } OPTIONAL { ?p wdt:P1142 ?i }
          OPTIONAL { ?ptwiki schema:about ?p ; schema:isPartOf <https://pt.wikipedia.org/> }
          OPTIONAL { ?enwiki schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en,mul". } }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of rows) {
        const q = qid(r.p)!;
        const e: PartyFacts = party.get(q) ?? { founded: null, founders: new Set(), chair: null, alignment: new Set(), ideologies: new Map() };
        e.founded ??= r.inc?.slice(0, 10) ?? null;
        if (r.fLabel && !/^Q\d+$/.test(r.fLabel)) e.founders.add(r.fLabel);
        if (r.chLabel && !/^Q\d+$/.test(r.chLabel)) e.chair ??= r.chLabel;
        if (r.alLabel && !/^Q\d+$/.test(r.alLabel)) e.alignment.add(r.alLabel);
        if (r.i && r.iLabel && !/^Q\d+$/.test(r.iLabel)) e.ideologies.set(qid(r.i)!, r.iLabel);
        e.ptwiki ??= r.ptwiki;
        e.enwiki ??= r.enwiki;
        party.set(q, e);
      }
    }
    const [ptEx, enEx] = await Promise.all([
      wikiExtracts("pt", [...party.values()].map((p) => p.ptwiki).filter(Boolean).map((u) => wikiTitle(u!)), 6),
      wikiExtracts("en", [...party.values()].filter((p) => !p.ptwiki && p.enwiki).map((p) => wikiTitle(p.enwiki!)), 6),
    ]);

    // 2. The leader's own ideology labels and declared influences.
    const leaderQids = [...new Set(govs.map((g) => g.leader_qid).filter(Boolean) as string[])];
    const leader = new Map<string, { ideologies: Map<string, string>; influencedBy: Map<string, string> }>();
    for (const batch of chunks(leaderQids, 150)) {
      const rows = await sparql(
        `SELECT ?p ?k ?v ?vLabel WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
          { ?p wdt:P1142 ?v . BIND("i" AS ?k) } UNION { ?p wdt:P737 ?v . BIND("f" AS ?k) }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en,mul". } }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of rows) {
        const e = leader.get(qid(r.p)!) ?? { ideologies: new Map(), influencedBy: new Map() };
        if (r.vLabel && !/^Q\d+$/.test(r.vLabel)) (r.k === "i" ? e.ideologies : e.influencedBy).set(qid(r.v)!, r.vLabel);
        leader.set(qid(r.p)!, e);
      }
    }

    // 2b. Who the leader is: description, portrait, occupations and the Wikipedia lead.
    const bio = new Map<string, { desc?: string; img?: string; birth?: string; ptwiki?: string; enwiki?: string; occs: Set<string> }>();
    for (const batch of chunks(leaderQids, 150)) {
      const rows = await sparql(
        `SELECT ?p ?dpt ?den ?img ?birth ?ptwiki ?enwiki ?occLabel WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} }
          OPTIONAL { ?p schema:description ?dpt FILTER(LANG(?dpt) = "pt") } OPTIONAL { ?p schema:description ?den FILTER(LANG(?den) = "en") }
          OPTIONAL { ?p wdt:P18 ?img } OPTIONAL { ?p wdt:P569 ?birth } OPTIONAL { ?p wdt:P106 ?occ }
          OPTIONAL { ?ptwiki schema:about ?p ; schema:isPartOf <https://pt.wikipedia.org/> }
          OPTIONAL { ?enwiki schema:about ?p ; schema:isPartOf <https://en.wikipedia.org/> }
          SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en,mul". } }`,
        { ttlHours: 24 * 7 },
      );
      for (const r of rows) {
        const e = bio.get(qid(r.p)!) ?? { occs: new Set<string>() };
        e.desc ??= r.dpt ?? r.den;
        e.img ??= r.img ? `https://commons.wikimedia.org/wiki/Special:FilePath/${r.img.split("/").pop()}?width=200` : undefined;
        e.birth ??= r.birth;
        e.ptwiki ??= r.ptwiki;
        e.enwiki ??= r.enwiki;
        if (r.occLabel && !/^Q\d+$/.test(r.occLabel)) e.occs.add(r.occLabel);
        bio.set(qid(r.p)!, e);
      }
    }
    const [leaderPt, leaderEn] = await Promise.all([
      wikiExtracts("pt", [...bio.values()].map((b) => b.ptwiki).filter(Boolean).map((u) => wikiTitle(u!)), 5),
      wikiExtracts("en", [...bio.values()].filter((b) => !b.ptwiki && b.enwiki).map((b) => wikiTitle(b.enwiki!)), 5),
    ]);

    // 3. Living, notable members of the ruling party (P102). One query per party
    // (big parties time out when batched), a few in parallel, failures skipped.
    const affiliated = new Map<string, Map<string, Raw>>(); // party → people
    let failedParties = 0;
    await pool(partyQids, 3, async (pq) => {
      try {
        const rows = await sparql(
          `SELECT ?p ?sl WHERE { ?p wdt:P102 wd:${pq} ; wikibase:sitelinks ?sl . FILTER(?sl >= 10)
            ?p wdt:P31 wd:Q5 . FILTER NOT EXISTS { ?p wdt:P570 ?d } } ORDER BY DESC(?sl) LIMIT 120`,
          { ttlHours: 24 * 7 },
        );
        const m = new Map<string, Raw>();
        for (const r of rows) {
          const q = qid(r.p)!;
          m.set(q, { qid: q, name: q, description: null, image: null, sl: Number(r.sl), occs: new Set(), shared: new Set() });
        }
        affiliated.set(pq, m);
      } catch (err) {
        failedParties++;
        log.warn(`membros de ${pq}: ${(err as Error).message}`);
      }
    });
    // Keep the 80 most notable per party before fetching occupations.
    for (const [k, m] of affiliated) affiliated.set(k, new Map([...m].sort((a, b) => b[1].sl - a[1].sl).slice(0, 80)));

    // 4. Living compatriots who share an ideology label with the party or the leader.
    const shared = new Map<string, Map<string, Raw>>(); // country → people
    const pairs: [string, string, string, string][] = []; // country code, country qid, ideology qid, label
    for (const g of govs) {
      if (!g.country_qid) continue;
      const labels = new Map([...(g.party_qid ? (party.get(g.party_qid)?.ideologies ?? new Map()) : new Map()), ...(g.leader_qid ? (leader.get(g.leader_qid)?.ideologies ?? new Map()) : new Map())]);
      for (const [i, l] of labels) pairs.push([g.country_code.trim(), g.country_qid, i, l as string]);
    }
    for (const batch of chunks(pairs, 40)) {
      let rows: Record<string, string>[] = [];
      try {
        rows = await sparql(
        `SELECT ?c ?i ?p ?sl WHERE { VALUES (?c ?i) { ${batch.map(([, c, i]) => `(wd:${c} wd:${i})`).join(" ")} }
          ?p wdt:P1142 ?i ; wdt:P27 ?c ; wdt:P31 wd:Q5 ; wikibase:sitelinks ?sl . FILTER(?sl >= 6)
          FILTER NOT EXISTS { ?p wdt:P570 ?d } }`,
        { ttlHours: 24 * 7 },
      );
      } catch (err) {
        log.warn(`ideologias compartilhadas: ${(err as Error).message}`);
      }
      for (const r of rows) {
        const pair = batch.find(([, c, i]) => c === qid(r.c) && i === qid(r.i))!;
        const m = shared.get(pair[0]) ?? new Map<string, Raw>();
        const q = qid(r.p)!;
        const e = m.get(q) ?? { qid: q, name: q, description: null, image: null, sl: Number(r.sl), occs: new Set(), shared: new Set() };
        e.shared.add(pair[3]);
        m.set(q, e);
        shared.set(pair[0], m);
      }
    }

    // 5. Occupations/descriptions for everyone we may show.
    const everyone = new Map<string, Raw>();
    for (const m of [...affiliated.values(), ...shared.values()]) for (const [k, v] of m) everyone.set(k, v);
    await enrich(everyone);
    // enrich() mutated the shared objects only through `everyone`; copy back.
    const sync = (m: Map<string, Raw>) => {
      for (const [k, v] of m) {
        const e = everyone.get(k)!;
        v.name = e.name;
        v.description = e.description;
        v.image = e.image;
        v.occs = e.occs;
      }
    };
    for (const m of [...affiliated.values(), ...shared.values()]) sync(m);

    // 6. Write.
    let written = 0;
    for (const g of govs) {
      const code = g.country_code.trim();
      const exclude = new Set([g.leader_qid, g.hos_qid, g.hog_qid].filter(Boolean));
      const p = g.party_qid ? party.get(g.party_qid) : undefined;
      const ex = p?.ptwiki ? ptEx.get(wikiTitle(p.ptwiki)) : p?.enwiki ? enEx.get(wikiTitle(p.enwiki)) : undefined;
      const aff = [...(g.party_qid ? (affiliated.get(g.party_qid)?.values() ?? []) : [])]
        .filter((r) => !exclude.has(r.qid) && isIntellectual([...r.occs]))
        .sort((a, b) => b.sl - a.sl)
        .slice(0, MAX);
      const affSet = new Set(aff.map((a) => a.qid));
      const sh = [...(shared.get(code)?.values() ?? [])]
        .filter((r) => !exclude.has(r.qid) && !affSet.has(r.qid) && isIntellectual([...r.occs]))
        .sort((a, b) => b.shared.size - a.shared.size || b.sl - a.sl)
        .slice(0, MAX);
      const l = g.leader_qid ? leader.get(g.leader_qid) : undefined;
      const values = {
        countryCode: code,
        party:
          g.party_qid && p
            ? {
                qid: g.party_qid,
                name: g.party_name ?? g.party_qid,
                founded: p.founded,
                founders: [...p.founders].slice(0, 5),
                chair: p.chair,
                alignment: [...p.alignment],
                ideologies: [...p.ideologies].map(([q, label]) => ({ qid: q, label })),
                summary: ex?.extract ?? null,
                summaryUrl: ex?.url ?? null,
              }
            : null,
        leader:
          g.leader_qid
            ? {
                qid: g.leader_qid,
                name: g.leader_name ?? g.leader_qid,
                ideologies: [...(l?.ideologies ?? new Map())].map(([q, label]) => ({ qid: q, label })),
                influencedBy: [...(l?.influencedBy ?? new Map())].map(([q, label]) => ({ qid: q, label })),
                ...leaderBio(bio.get(g.leader_qid), leaderPt, leaderEn),
              }
            : null,
        affiliated: aff.map((r) => toPerson({ ...r, shared: new Set() })),
        sharedIdeology: sh.map(toPerson),
        sourceId: "wikidata",
        sourceUrl: g.party_qid ? `https://www.wikidata.org/wiki/${g.party_qid}` : null,
        updatedAt: new Date(),
      };
      await db.insert(schema.governmentContext).values(values).onConflictDoUpdate({ target: schema.governmentContext.countryCode, set: { ...values, countryCode: undefined } });
      written++;
    }
    await touchSource("wikidata");
    return { governments: written, parties: party.size, partiesWithMembers: affiliated.size, failedParties, countriesWithShared: shared.size };
  },
};

