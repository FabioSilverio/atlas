import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import electionCrosswalk from "@/data/seed/election-party-crosswalk.json";
import { db, schema } from "@/lib/db/client";
import { SOURCE_SHORT } from "@/lib/ideology/derive";
import { loadPartyFactsCore } from "../lib/datasets";
import { fetchJson } from "../lib/http";
import { findElectionInfoboxes, interpret, type ParsedElection } from "../lib/infobox";
import { touchSource, type Job } from "../lib/job";
import { getState, setState } from "../lib/state";
import { log } from "../lib/log";
import { loadPartyScores } from "../lib/party-scores";
import { qid, sparql } from "../lib/sparql";
import { wikiKey } from "../lib/text";
import { chunks } from "../lib/wiki";

const FIRST_YEAR = 2005;
const TYPES = "general|parliamentary|presidential|legislative|federal|congressional|national assembly|house of representatives|senate|chamber of deputies|national|state duma|majlis";
// Vercel functions have ~300 s; locally there is no budget.
const budgetMs = () => (process.env.VERCEL ? 200_000 : Number.POSITIVE_INFINITY);

type Crosswalk = Record<string, { partyfacts_id: number; note: string }>;
const crosswalk = electionCrosswalk as unknown as Crosswalk;

/** English adjectives/names Wikipedia uses in election titles ("Brazilian", "United Kingdom"). */
async function adjectives(countries: { code: string; qid: string | null; nameEn: string }[]) {
  const out = new Map<string, Set<string>>();
  for (const c of countries) out.set(c.code, new Set([c.nameEn]));
  const byQid = new Map(countries.filter((c) => c.qid).map((c) => [c.qid!, c.code]));
  for (const batch of chunks([...byQid.keys()], 150)) {
    const rows = await sparql(
      `SELECT ?c ?d ?en WHERE { VALUES ?c { ${batch.map((q) => `wd:${q}`).join(" ")} }
        OPTIONAL { ?c wdt:P1549 ?d FILTER(LANG(?d) = "en") } OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") } }`,
      { ttlHours: 24 * 30 },
    );
    for (const r of rows) {
      const set = out.get(byQid.get(qid(r.c)!)!)!;
      if (r.d) set.add(r.d);
      if (r.en) set.add(r.en);
    }
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Discovers national election articles for one country through Wikipedia's search. */
async function discover(code: string, adj: Set<string>): Promise<{ title: string; year: number }[]> {
  const found = new Map<string, number>();
  for (const a of adj) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srnamespace=0&srlimit=500&srsearch=${encodeURIComponent(`intitle:"${a}" intitle:election`)}`;
    type R = { query?: { search?: { title: string }[] } };
    const json = await fetchJson<R>(url, { ttlHours: 24 * 30 });
    const re = new RegExp(`^(\\d{4}) (?:${escape(a)}) (?:${TYPES})(?: and [a-z ]+)? elections?$`, "i");
    for (const s of json.query?.search ?? []) {
      const m = s.title.match(re);
      if (m && Number(m[1]) >= FIRST_YEAR) found.set(s.title, Number(m[1]));
    }
  }
  return [...found].map(([title, year]) => ({ title, year }));
}

export const electionsJob: Job = {
  name: "elections",
  description: "eleições nacionais desde 2005 (infoboxes da Wikipédia) + posição ponderada por cadeiras",
  async run() {
    const deadline = Date.now() + budgetMs();
    const countries = await db
      .select({ code: schema.countries.code, qid: schema.countries.wikidataQid, nameEn: schema.countries.nameEn, namePt: schema.countries.namePt, neType: schema.countries.neType })
      .from(schema.countries);
    const sovereign = countries.filter((c) => /Sovereign|Country/.test(c.neType ?? "")).map((c) => ({ ...c, code: c.code.trim() }));

    // 1. Discovery, a slice of countries per run (round-robin cursor).
    const adj = await adjectives(sovereign);
    const cursor = await getState<number>("elections.discover.cursor", 0);
    let i = cursor;
    let discovered = 0;
    for (let n = 0; n < sovereign.length && Date.now() < deadline - 120_000; n++, i = (i + 1) % sovereign.length) {
      const c = sovereign[i];
      for (const a of await discover(c.code, adj.get(c.code)!)) {
        const r = await db.insert(schema.electionArticles).values({ title: a.title, countryCode: c.code, year: a.year }).onConflictDoNothing().returning();
        discovered += r.length;
      }
    }
    await setState("elections.discover.cursor", i);

    // 2. Which articles to (re)read: recent/upcoming every run, older ones monthly.
    const thisYear = new Date().getFullYear();
    const monthAgo = new Date(Date.now() - 30 * 864e5);
    const todo = await db
      .select()
      .from(schema.electionArticles)
      .where(or(gte(schema.electionArticles.year, thisYear - 1), isNull(schema.electionArticles.checkedAt), lt(schema.electionArticles.checkedAt, monthAgo)))
      .orderBy(desc(schema.electionArticles.year));

    // 3. Party → Party Facts → best academic score.
    const [scores, core, ourParties] = await Promise.all([
      loadPartyScores(),
      loadPartyFactsCore(),
      db.select({ id: schema.parties.id, enwiki: schema.parties.enwiki, pf: schema.parties.partyfactsId }).from(schema.parties),
    ]);
    const pfByWiki = new Map<string, number>();
    for (const r of core) {
      const k = wikiKey(r.wikipedia);
      if (k) pfByWiki.set(k, Number(r.partyfacts_id));
    }
    const ourByWiki = new Map(ourParties.filter((p) => p.enwiki).map((p) => [wikiKey(p.enwiki)!, p]));
    for (const p of ourParties) if (p.enwiki && p.pf) pfByWiki.set(wikiKey(p.enwiki)!, p.pf);

    // Wikipedia redirects: party articles are often renamed after the Party Facts entry was made.
    const redirectCache = new Map<string, string>();
    async function resolveTitles(titles: string[]) {
      const need = titles.filter((t) => !redirectCache.has(t) && !pfByWiki.has(wikiKey(t)!));
      for (const batch of chunks([...new Set(need)], 50)) {
        if (Date.now() > deadline) break;
        const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=redirects&rdlimit=max&titles=${encodeURIComponent(batch.join("|"))}`;
        type R = { query?: { redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[]; pages?: { title: string; redirects?: { title: string }[] }[] } };
        const json = await fetchJson<R>(url, { ttlHours: 24 * 30 });
        const canon = new Map<string, string>();
        for (const n of json.query?.normalized ?? []) canon.set(n.from, n.to);
        for (const r of json.query?.redirects ?? []) canon.set(r.from, r.to);
        for (const t of batch) {
          const target = canon.get(canon.get(t) ?? t) ?? canon.get(t) ?? t;
          const page = json.query?.pages?.find((p) => p.title === target);
          const names = [target, ...(page?.redirects?.map((r) => r.title) ?? [])];
          const hit = names.find((n) => pfByWiki.has(wikiKey(n)!));
          redirectCache.set(t, hit ?? target);
        }
      }
    }
    const pfFor = (title: string | null, label: string): { pf: number | null; note?: string } => {
      const cw = crosswalk[label] ?? (title ? crosswalk[title] : undefined);
      if (cw) return { pf: cw.partyfacts_id, note: cw.note };
      if (!title) return { pf: null };
      const k = wikiKey(redirectCache.get(title) ?? title)!;
      return { pf: pfByWiki.get(k) ?? pfByWiki.get(wikiKey(title)!) ?? null };
    };

    // 4. Read articles in batches of 50 (one request each), parse infoboxes.
    let parsed = 0;
    let upserted = 0;
    const newlyHeld: { code: string; id: number }[] = [];
    for (const batch of chunks(todo, 50)) {
      if (Date.now() > deadline) break;
      const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=revisions&rvprop=ids|content&rvslots=main&titles=${encodeURIComponent(batch.map((b) => b.title).join("|"))}`;
      type R = { query?: { pages?: { title: string; missing?: boolean; revisions?: { revid: number; slots: { main: { content: string } } }[] }[]; redirects?: { from: string; to: string }[]; normalized?: { from: string; to: string }[] } };
      // Recent elections change by the hour on election night; cache those briefly.
      const json = await fetchJson<R>(url, { ttlHours: batch.some((b) => b.year >= thisYear - 1) ? 2 : 24 * 7 });
      const back = new Map<string, string>();
      for (const n of json.query?.normalized ?? []) back.set(n.to, n.from);
      for (const r of json.query?.redirects ?? []) back.set(r.to, back.get(r.from) ?? r.from);

      for (const page of json.query?.pages ?? []) {
        const title = back.get(page.title) ?? page.title;
        const art = batch.find((b) => b.title === title) ?? batch.find((b) => b.title === page.title);
        if (!art) continue;
        const rev = page.revisions?.[0];
        await db.update(schema.electionArticles).set({ checkedAt: new Date(), revid: rev?.revid ?? null }).where(eq(schema.electionArticles.title, art.title));
        if (!rev) continue;
        const elections = findElectionInfoboxes(rev.slots.main.content).map(interpret).filter((e): e is ParsedElection => !!e);
        const parentDate = elections.find((e) => e.date)?.date ?? null;
        await resolveTitles(elections.flatMap((e) => e.results.map((r) => r.party).filter(Boolean) as string[]));

        for (const e of elections) {
          const date = e.date ?? parentDate;
          if (!date || Number(date.slice(0, 4)) !== art.year) continue;
          parsed++;
          const results = e.results.map((r) => {
            const { pf, note } = pfFor(r.party, r.partyLabel);
            const s = pf ? scores.get(pf) : undefined;
            const ours = r.party ? ourByWiki.get(wikiKey(r.party)!) : undefined;
            return { ...r, pf, note, s, partyId: ours?.id ?? null };
          });
          // Weighted position: seats for legislatures, votes for presidential races.
          const weightOf = (r: (typeof results)[number]) => (e.kind === "legislative" ? (r.seats ?? 0) : (r.share ?? 0));
          const total = results.reduce((a, r) => a + weightOf(r), 0);
          const wavg = (dim: "econ" | "galtan") => {
            const scored = results.filter((r) => r.s?.[dim] != null && weightOf(r) > 0);
            const w = scored.reduce((a, r) => a + weightOf(r), 0);
            return { v: w ? scored.reduce((a, r) => a + weightOf(r) * r.s![dim]!, 0) / w : null, cov: total ? w / total : 0 };
          };
          const econ = wavg("econ");
          const gal = wavg("galtan");
          const status = e.ongoing || (!e.winner && e.kind === "presidential" && date >= new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) ? "ongoing" : "held";
          const values = {
            countryCode: art.countryCode,
            date,
            kind: e.kind,
            body: e.body.slice(0, 120),
            title: art.title,
            status,
            turnout: e.turnout == null ? null : String(e.turnout),
            totalSeats: e.totalSeats ?? (e.kind === "legislative" ? results.reduce((a, r) => a + (r.seats ?? 0), 0) || null : null),
            econ: econ.v == null ? null : econ.v.toFixed(3),
            galtan: gal.v == null ? null : gal.v.toFixed(3),
            coverage: econ.cov.toFixed(3),
            winner: e.winner,
            runoffDate: e.runoff,
            wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
            sourceId: "wikipedia-elections",
            sourceUrl: `https://en.wikipedia.org/w/index.php?oldid=${rev.revid}`,
            updatedAt: new Date(),
          };
          const [existing] = await db
            .select({ id: schema.elections.id })
            .from(schema.elections)
            .where(and(eq(schema.elections.countryCode, art.countryCode), eq(schema.elections.date, date), eq(schema.elections.body, values.body)));
          let id: number;
          if (existing) {
            id = existing.id;
            await db.update(schema.elections).set(values).where(eq(schema.elections.id, id));
          } else {
            [{ id }] = await db.insert(schema.elections).values(values).returning({ id: schema.elections.id });
            if (date >= new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10)) newlyHeld.push({ code: art.countryCode, id });
          }
          await db.delete(schema.electionResults).where(eq(schema.electionResults.electionId, id));
          if (results.length)
            await db.insert(schema.electionResults).values(
              results.map((r) => ({
                electionId: id,
                position: r.position,
                partyLabel: r.partyLabel.slice(0, 200),
                partyWiki: r.party,
                partyId: r.partyId,
                partyfactsId: r.pf,
                candidate: r.candidate,
                seats: r.seats,
                seatsBefore: r.seatsBefore,
                votes: r.votes == null ? null : String(r.votes),
                voteShare: r.share == null ? null : String(r.share),
                econ: r.s?.econ == null ? null : r.s.econ.toFixed(3),
                galtan: r.s?.galtan == null ? null : r.s.galtan.toFixed(3),
                scoreSource: r.s ? `${SOURCE_SHORT[r.s.sourceId] ?? r.s.sourceId}${r.note ? ` · ${r.note}` : ""}` : null,
              })),
            );
          upserted++;
        }
      }
    }

    // 5. Feed: new results within the last weeks, with the drift against the previous election for the same body.
    for (const { code, id } of newlyHeld) {
      const [e] = await db.select().from(schema.elections).where(eq(schema.elections.id, id));
      const [prev] = await db
        .select()
        .from(schema.elections)
        .where(and(eq(schema.elections.countryCode, code), eq(schema.elections.body, e.body), lt(schema.elections.date, e.date)))
        .orderBy(desc(schema.elections.date))
        .limit(1);
      const name = countries.find((c) => c.code.trim() === code)?.namePt ?? code;
      const drift = e.econ != null && prev?.econ != null ? Number(e.econ) - Number(prev.econ) : null;
      const driftText = drift == null ? "" : Math.abs(drift) < 0.03 ? " · sem deriva relevante" : ` · deriva ${drift > 0 ? "à direita" : "à esquerda"} (${drift > 0 ? "+" : "−"}${Math.abs(drift).toFixed(2)})`;
      await db
        .insert(schema.events)
        .values({
          type: "election_held",
          countryCode: code,
          occurredAt: new Date(`${e.date}T12:00:00Z`),
          title: `${name}: ${e.kind === "presidential" ? "eleição presidencial" : e.body}${driftText}`,
          payload: { electionId: id, drift },
          dedupeKey: `election:${code}:${e.date}:${e.body}`,
          sourceId: "wikipedia-elections",
          sourceUrl: e.wikipediaUrl,
        })
        .onConflictDoNothing();
    }

    await touchSource("wikipedia-elections");
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.elections);
    log.info(`eleições no banco: ${n}`);
    return { discovered, articlesChecked: todo.length, modulesParsed: parsed, electionsUpserted: upserted, elections: n, cursor: i };
  },
};

