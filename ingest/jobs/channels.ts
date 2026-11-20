import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { touchSource, type Job } from "../lib/job";
import { log } from "../lib/log";
import { qid, sparql } from "../lib/sparql";
import { chunks } from "../lib/wiki";
import voices from "@/data/seed/voices.json";

// Wikidata classes of news organisations whose channels we follow.
const MEDIA_TYPES = ["Q1193236", "Q11032", "Q1110794", "Q1616075", "Q2001305", "Q17232649", "Q1153191", "Q192283", "Q15265344", "Q41298", "Q1331793", "Q14350"];
const MEDIA_PER_COUNTRY = 15;
const POLITICIANS_PER_COUNTRY = 20;

type Row = typeof schema.channels.$inferInsert;

/**
 * YouTube channels to monitor per country, all identified on Wikidata (P2397):
 * party channels and politicians' channels (their side comes from the party's
 * academic score) and the most notable national news organisations (no side).
 * Editor-curated voices (data/seed/voices.json) are added with their channel when known.
 */
export const channelsJob: Job = {
  name: "channels",
  description: "canais de YouTube por país: partidos, políticos e imprensa (Wikidata P2397)",
  async run() {
    const actors = (await db.execute(sql`select country_code, kind, qid, name, econ, party_label, score_source, sitelinks from actors where qid is not null`)) as unknown as {
      country_code: string; kind: string; qid: string; name: string; econ: string | null; party_label: string | null; score_source: string | null; sitelinks: number | null;
    }[];
    const byQid = new Map(actors.map((a) => [a.qid, a]));
    const rows = new Map<string, Row>();
    let failed = 0;

    for (const batch of chunks([...byQid.keys()], 150)) {
      try {
        const res = await sparql(`SELECT ?p ?yt WHERE { VALUES ?p { ${batch.map((q) => `wd:${q}`).join(" ")} } ?p wdt:P2397 ?yt }`, { ttlHours: 24 * 7 });
        for (const r of res) {
          const a = byQid.get(qid(r.p)!)!;
          if (rows.has(r.yt)) continue;
          rows.set(r.yt, {
            channelId: r.yt, countryCode: a.country_code.trim(), ownerQid: a.qid, ownerName: a.name, ownerKind: a.kind === "party" ? "party" : "politician",
            econ: a.econ, leanBasis: a.econ == null ? null : a.kind === "party" ? `canal do partido (${a.score_source ?? "posição acadêmica"})` : `canal de político do ${a.party_label} (${a.score_source ?? "posição acadêmica"})`,
            sitelinks: a.sitelinks, sourceId: "wikidata", sourceUrl: `https://www.wikidata.org/wiki/${a.qid}`, updatedAt: new Date(),
          });
        }
      } catch (err) {
        failed++;
        log.warn(`canais de atores: ${(err as Error).message}`);
      }
    }
    // Keep the most notable politicians per country.
    const perCountry = new Map<string, Row[]>();
    for (const r of rows.values()) if (r.ownerKind === "politician") perCountry.set(r.countryCode, [...(perCountry.get(r.countryCode) ?? []), r]);
    for (const list of perCountry.values()) for (const r of list.sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0)).slice(POLITICIANS_PER_COUNTRY)) rows.delete(r.channelId);

    // National news media.
    const countries = (await db.execute(sql`select code, wikidata_qid from countries where wikidata_qid is not null and ne_type in ('Sovereign country', 'Country')`)) as unknown as { code: string; wikidata_qid: string }[];
    const codeByQid = new Map(countries.map((c) => [c.wikidata_qid, c.code.trim()]));
    const media = new Map<string, Row[]>();
    // One query per kind of outlet (crossing countries × kinds in one query times out).
    for (const type of MEDIA_TYPES) {
      try {
        const res = await sparql(
          `SELECT ?m ?c ?yt ?sl ?mLabel WHERE {
            ?m wdt:P31 wd:${type} ; wdt:P2397 ?yt ; wdt:P17 ?c ; wikibase:sitelinks ?sl . FILTER(?sl >= 3)
            FILTER NOT EXISTS { ?m wdt:P576 ?end }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul,pt,es,fr". } }`,
          { ttlHours: 24 * 7 },
        );
        for (const r of res) {
          const code = codeByQid.get(qid(r.c)!);
          if (!code || !r.mLabel || /^Q\d+$/.test(r.mLabel)) continue;
          media.set(code, [...(media.get(code) ?? []), {
            channelId: r.yt, countryCode: code, ownerQid: qid(r.m) ?? null, ownerName: r.mLabel, ownerKind: "media", econ: null, leanBasis: null,
            sitelinks: Number(r.sl), sourceId: "wikidata", sourceUrl: `https://www.wikidata.org/wiki/${qid(r.m)}`, updatedAt: new Date(),
          }]);
        }
      } catch (err) {
        failed++;
        log.warn(`canais de imprensa (${type}): ${(err as Error).message}`);
      }
    }
    for (const list of media.values()) {
      const seen = new Set<string>();
      for (const r of list.sort((a, b) => (b.sitelinks ?? 0) - (a.sitelinks ?? 0)).filter((r) => !seen.has(r.ownerQid!) && (seen.add(r.ownerQid!), true)).slice(0, MEDIA_PER_COUNTRY))
        if (!rows.has(r.channelId)) rows.set(r.channelId, r);
    }

    // Editor-curated voices with a known channel.
    for (const v of voices as Voice[])
      if (v.youtube && !rows.has(v.youtube))
        rows.set(v.youtube, { channelId: v.youtube, countryCode: v.country, ownerQid: null, ownerName: v.name, ownerKind: "voice", econ: null, leanBasis: `curadoria do editor: ${v.camp}`, sitelinks: null, sourceId: "atlas-pulse", sourceUrl: v.x ? `https://x.com/${v.x}` : null, updatedAt: new Date() });

    const values = [...rows.values()];
    await db.transaction(async (tx) => {
      // Keep checkedAt of channels we already know so the rotation continues.
      const known = new Map((await tx.select({ id: schema.channels.channelId, at: schema.channels.checkedAt }).from(schema.channels)).map((r) => [r.id, r.at]));
      await tx.delete(schema.channels);
      for (const b of chunks(values, 300)) await tx.insert(schema.channels).values(b.map((r) => ({ ...r, checkedAt: known.get(r.channelId) ?? null })));
    });
    await touchSource("youtube");
    const count = (k: string) => values.filter((v) => v.ownerKind === k).length;
    return { channels: values.length, parties: count("party"), politicians: count("politician"), media: count("media"), voices: count("voice"), failedQueries: failed };
  },
};

export type Voice = { country: string; name: string; camp: string; x: string | null; youtube: string | null; note?: string };
