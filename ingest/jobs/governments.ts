import overridesSeed from "@/data/seed/overrides/governments.json";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { chooseChiefExecutive, type Role } from "@/lib/ideology/chief-executive";
import { countryMatcher } from "../lib/countries";
import { loadHerreLatest } from "../lib/datasets";
import { fetchText } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { qid, sparql } from "../lib/sparql";

type Override = {
  chief_executive_role?: Role;
  head_of_state?: { qid: string; name: string };
  head_of_government?: { qid: string; name: string };
  party_qids?: string[];
  justification: string;
  source_url: string;
  verified_at: string;
};

type Head = { qid: string; name: string; nameEn?: string; start?: string; preferred: boolean };
type PartyRef = { qid: string; name: string; nameEn?: string; abbrev?: string; enwiki?: string; since?: string };
// Wikidata items that model "no party" as if it were a party.
const NOT_A_PARTY = new Set(["Q327591" /* independent politician */, "Q7049542" /* nonpartisanship */]);

function headsQuery(qids: string[]) {
  return `
SELECT ?country ?role ?person ?personLabel ?personEn ?start ?rank ?party ?partyLabel ?partyEn ?partyShort ?partyWiki ?pstart WHERE {
  VALUES ?country { ${qids.map((q) => `wd:${q}`).join(" ")} }
  VALUES (?prop ?psv ?role) { (p:P6 ps:P6 "hog") (p:P35 ps:P35 "hos") }
  ?country ?prop ?st .
  ?st ?psv ?person ; wikibase:rank ?rank .
  FILTER(?rank != wikibase:DeprecatedRank)
  FILTER NOT EXISTS { ?st pq:P582 ?end }
  OPTIONAL { ?st pq:P580 ?start }
  OPTIONAL { ?person rdfs:label ?personEn FILTER(LANG(?personEn) = "en") }
  OPTIONAL {
    ?person p:P102 ?ps . ?ps ps:P102 ?party ; wikibase:rank ?prank .
    FILTER(?prank != wikibase:DeprecatedRank)
    FILTER NOT EXISTS { ?ps pq:P582 ?pend }
    OPTIONAL { ?ps pq:P580 ?pstart }
    FILTER NOT EXISTS { ?party wdt:P31 wd:Q24649 }  # European-level parties (EPP, PES…) are not national parties
    OPTIONAL { ?party rdfs:label ?partyEn FILTER(LANG(?partyEn) = "en") }
    OPTIONAL { ?party wdt:P1813 ?partyShort }
    OPTIONAL { ?partyWiki schema:about ?party ; schema:isPartOf <https://en.wikipedia.org/> }
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,pt-br,en,mul". }
}`;
}

/** ElectionGuide's public "upcoming" table: country, election name, date, confirmed? */
async function upcomingElections(match: (n: string) => string | undefined) {
  const url = "https://www.electionguide.org/elections/type/upcoming/";
  const html = await fetchText(url, { ttlHours: 24 });
  const out = new Map<string, { date: string; name: string; confirmed: boolean; url: string }>();
  // Desktop table rows: <td><a href="/countries/id/N/">Country</a></td><td><a href="/elections/id/N/...">Name</a> … <td>YYYY-MM-DD … <td>Confirmed|Date not confirmed</td>
  const re =
    /<a href="\/countries\/id\/\d+\/">([^<]+)<\/a><\/td>\s*<td><a href="\/elections\/id\/(\d+)\/[^"]*">([^<]+)<\/a>[\s\S]*?<td>\s*(\d{4}-\d{2}-\d{2})[\s\S]*?<td>(Confirmed|Date not confirmed)<\/td>/g;
  let m: RegExpExecArray | null;
  let unmatched = 0;
  while ((m = re.exec(html))) {
    const [, country, id, name, date, status] = m;
    if (/referendum/i.test(name)) continue;
    const code = match(country.trim());
    if (!code) {
      unmatched++;
      log.warn("ElectionGuide: país não mapeado", country);
      continue;
    }
    const prev = out.get(code);
    if (!prev || date < prev.date)
      out.set(code, {
        date,
        name: name.trim(),
        confirmed: status === "Confirmed",
        url: `https://www.electionguide.org/elections/id/${id}/`,
      });
  }
  return { byCountry: out, unmatched };
}

async function upsertPerson(h: Head): Promise<number> {
  const [row] = await db
    .insert(schema.people)
    .values({
      wikidataQid: h.qid,
      name: h.name,
      sourceId: "wikidata",
      sourceUrl: `https://www.wikidata.org/wiki/${h.qid}`,
    })
    .onConflictDoUpdate({
      target: schema.people.wikidataQid,
      set: { name: sql`excluded.name`, updatedAt: new Date() },
    })
    .returning({ id: schema.people.id });
  return row.id;
}

async function upsertParty(p: PartyRef, countryCode: string): Promise<number> {
  const [row] = await db
    .insert(schema.parties)
    .values({
      wikidataQid: p.qid,
      countryCode,
      name: p.name,
      nameEn: p.nameEn ?? null,
      abbrev: p.abbrev ?? null,
      enwiki: p.enwiki ?? null,
      sourceId: "wikidata",
      sourceUrl: `https://www.wikidata.org/wiki/${p.qid}`,
    })
    .onConflictDoUpdate({
      target: schema.parties.wikidataQid,
      set: {
        name: sql`excluded.name`,
        nameEn: sql`excluded.name_en`,
        abbrev: sql`coalesce(excluded.abbrev, ${schema.parties.abbrev})`,
        enwiki: sql`excluded.enwiki`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: schema.parties.id });
  return row.id;
}

export const governmentsJob: Job = {
  name: "governments",
  description: "governos atuais (Wikidata P6/P35/P102) + regra do chefe do executivo + próxima eleição",
  async run() {
    const countries = await db
      .select({ code: schema.countries.code, qid: schema.countries.wikidataQid, name: schema.countries.namePt })
      .from(schema.countries);
    const byQid = new Map(countries.filter((c) => c.qid).map((c) => [c.qid!, c.code]));
    const overrides = overridesSeed as unknown as Record<string, Override>;
    const match = await countryMatcher();

    // 1. Wikidata — in chunks to keep each query small.
    const qids = [...byQid.keys()];
    const heads = new Map<string, { hos: Map<string, Head>; hog: Map<string, Head>; parties: Map<string, Map<string, PartyRef>> }>();
    for (let i = 0; i < qids.length; i += 60) {
      const rows = await sparql(headsQuery(qids.slice(i, i + 60)));
      for (const r of rows) {
        const code = byQid.get(qid(r.country)!)!;
        const entry = heads.get(code) ?? { hos: new Map(), hog: new Map(), parties: new Map() };
        heads.set(code, entry);
        const pq = qid(r.person)!;
        const target = r.role === "hos" ? entry.hos : entry.hog;
        if (!target.has(pq))
          target.set(pq, {
            qid: pq,
            name: r.personLabel && !/^Q\d+$/.test(r.personLabel) ? r.personLabel : (r.personEn ?? pq),
            nameEn: r.personEn,
            start: r.start?.slice(0, 10),
            preferred: r.rank.endsWith("PreferredRank"),
          });
        if (r.party && !NOT_A_PARTY.has(qid(r.party)!)) {
          const partyQ = qid(r.party)!;
          const ps = entry.parties.get(pq) ?? new Map<string, PartyRef>();
          entry.parties.set(pq, ps);
          if (!ps.has(partyQ))
            ps.set(partyQ, {
              qid: partyQ,
              name: r.partyLabel && !/^Q\d+$/.test(r.partyLabel) ? r.partyLabel : (r.partyEn ?? partyQ),
              nameEn: r.partyEn,
              abbrev: r.partyShort,
              enwiki: r.partyWiki,
              since: r.pstart?.slice(0, 10),
            });
        }
      }
    }

    // When several statements are open, prefer preferred-rank, then the latest start date.
    const pick = (m: Map<string, Head>): { head: Head | null; collective: boolean } => {
      const all = [...m.values()];
      if (!all.length) return { head: null, collective: false };
      const pool = all.some((h) => h.preferred) ? all.filter((h) => h.preferred) : all;
      pool.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? ""));
      return { head: pool[0], collective: pool.length > 1 };
    };

    // 2. Herre / V-Dem: who was the effective leader in the latest year.
    const herre = new Map<string, { match: "yes" | "no" | "n/a"; year: number; hogTitle: string }>();
    for (const r of await loadHerreLatest()) {
      const code = match(r.country_name);
      if (code) herre.set(code, { match: r.match_hog_leader as "yes" | "no" | "n/a", year: Number(r.year), hogTitle: r.hog_title });
    }

    // 3. Next elections.
    const elections = await upcomingElections(match);

    let created = 0;
    let updated = 0;
    let changed = 0;
    let noHeads = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const c of countries) {
      const h = heads.get(c.code);
      const ov = overrides[c.code];
      let hos = h ? pick(h.hos) : { head: null, collective: false };
      let hog = h ? pick(h.hog) : { head: null, collective: false };
      if (ov?.head_of_state) hos = { head: { ...ov.head_of_state, preferred: true }, collective: false };
      if (ov?.head_of_government) hog = { head: { ...ov.head_of_government, preferred: true }, collective: false };
      if (!hos.head && !hog.head) {
        noHeads++;
        continue;
      }

      const hz = herre.get(c.code);
      const chief = chooseChiefExecutive({
        hosQid: hos.head?.qid,
        hogQid: hog.head?.qid,
        herreMatchHogLeader: hz?.match,
        herreYear: hz?.year,
        herreHogTitle: hz?.hogTitle,
        override: ov?.chief_executive_role ? { role: ov.chief_executive_role, justification: ov.justification } : null,
      });
      const chiefHead = chief.role === "head_of_state" ? hos.head! : hog.head!;
      const otherHead = chief.role === "head_of_state" ? hog.head : hos.head;
      let rule = chief.rule;
      const coll = chief.role === "head_of_state" ? hos.collective : hog.collective;
      if (coll) rule += " Há mais de um titular registrado (chefia colegiada ou dado ambíguo); exibimos o mais recente.";

      const hosId = hos.head ? await upsertPerson(hos.head) : null;
      const hogId = hog.head ? await upsertPerson(hog.head) : null;

      // Parties: those of the chief executive lead; the other head's are kept for context.
      // Most recent membership first: Wikidata often leaves old affiliations open.
      const chiefParties = [...(h?.parties.get(chiefHead.qid)?.values() ?? [])]
        .filter((p) => !ov?.party_qids || ov.party_qids.includes(p.qid))
        .sort((a, b) => (b.since ?? "").localeCompare(a.since ?? ""));
      const otherParties = otherHead ? [...(h?.parties.get(otherHead.qid)?.values() ?? [])] : [];

      const next = elections.byCountry.get(c.code);
      const values = {
        countryCode: c.code,
        headOfStateId: hosId,
        headOfGovernmentId: hogId,
        chiefExecutiveRole: chief.role,
        chiefExecutiveRule: rule,
        startedOn: chiefHead.start ?? null,
        nextElectionOn: next?.date ?? null,
        nextElectionName: next?.name ?? null,
        nextElectionConfirmed: next?.confirmed ?? null,
        nextElectionSourceUrl: next?.url ?? null,
        verifiedAt: new Date(),
        sourceId: ov ? "atlas-curation" : "wikidata",
        sourceUrl: ov?.source_url ?? `https://www.wikidata.org/wiki/${c.qid}`,
        updatedAt: new Date(),
      };

      const [current] = await db
        .select()
        .from(schema.governments)
        .where(and(eq(schema.governments.countryCode, c.code), isNull(schema.governments.endedOn)));

      let govId: number;
      const chiefId = chief.role === "head_of_state" ? hosId : hogId;
      const currentChiefId = current
        ? current.chiefExecutiveRole === "head_of_state"
          ? current.headOfStateId
          : current.headOfGovernmentId
        : null;

      if (current && currentChiefId === chiefId && current.headOfStateId === hosId && current.headOfGovernmentId === hogId) {
        await db.update(schema.governments).set(values).where(eq(schema.governments.id, current.id));
        govId = current.id;
        updated++;
      } else {
        if (current) {
          await db.update(schema.governments).set({ endedOn: today }).where(eq(schema.governments.id, current.id));
        }
        const [row] = await db.insert(schema.governments).values(values).returning({ id: schema.governments.id });
        govId = row.id;
        created++;
        // News = a new person at the top. Not the first load, and not a rule/override
        // that merely switches which of the same two people counts as chief.
        const samePeople = current && [current.headOfStateId, current.headOfGovernmentId].includes(chiefId);
        if (current && currentChiefId !== chiefId && !samePeople) {
          changed++;
          await db
            .insert(schema.events)
            .values({
              type: "government_change",
              countryCode: c.code,
              occurredAt: new Date(),
              title: `${c.name}: ${chiefHead.name} assume a chefia do executivo`,
              payload: { previousGovernmentId: current.id, governmentId: govId, role: chief.role },
              dedupeKey: `gov:${c.code}:${chiefHead.qid}`,
              sourceId: "wikidata",
              sourceUrl: `https://www.wikidata.org/wiki/${chiefHead.qid}`,
            })
            .onConflictDoNothing();
        }
      }

      await db.delete(schema.governmentParties).where(eq(schema.governmentParties.governmentId, govId));
      const seen = new Set<number>();
      let position = 0;
      for (const [list, role] of [
        [chiefParties, "leader"],
        [otherParties, "other_head"],
      ] as const) {
        for (const p of list) {
          const partyId = await upsertParty(p, c.code);
          if (seen.has(partyId)) continue;
          seen.add(partyId);
          await db.insert(schema.governmentParties).values({ governmentId: govId, partyId, role, position: position++, memberSince: p.since ?? null });
        }
      }
    }

    await touchSource("wikidata");
    await touchSource("electionguide");
    return {
      countries: countries.length,
      governmentsCreated: created,
      governmentsUpdated: updated,
      governmentChanges: changed,
      noHeadsInWikidata: noHeads,
      nextElections: elections.byCountry.size,
      electionguideUnmatched: elections.unmatched,
    };
  },
};
