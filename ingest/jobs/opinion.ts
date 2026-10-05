import { XMLParser } from "fast-xml-parser";
import { and, gte, sql } from "drizzle-orm";
import outletsSeed from "@/data/seed/outlets.json";
import { db, schema } from "@/lib/db/client";
import { fetchCached, fetchJson } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { keyphrases } from "../lib/keyphrases";
import { log } from "../lib/log";
import { qid, sparql } from "../lib/sparql";
import { norm } from "../lib/text";
import { chunks } from "../lib/wiki";

type SeedOutlet = { id: string; country: string; name: string; url: string; language: string; kind: string; feeds: string[] };
const OUTLETS = (outletsSeed as { outlets: SeedOutlet[] }).outlets;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text", processEntities: true });

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text((v as Record<string, unknown>)["#text"] ?? (v as Record<string, unknown>).name ?? "");
  return "";
};
const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

type Item = { title: string; url: string; author: string | null; published: Date };

function parseFeed(xml: string): Item[] {
  const doc = parser.parse(xml);
  const rss = doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item;
  const atom = doc.feed?.entry;
  const raw = (rss ?? atom ?? []) as Record<string, unknown>[];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((it) => {
      const link = atom
        ? text((Array.isArray(it.link) ? (it.link as Record<string, string>[]).find((l) => l["@rel"] !== "self") : (it.link as Record<string, string>))?.["@href"])
        : text(it.link) || text(it.guid);
      const author = decode(text(it["dc:creator"]) || text(it.author) || "") || null;
      const date = new Date(text(it.pubDate) || text(it["dc:date"]) || text(it.published) || text(it.updated));
      return { title: decode(text(it.title)), url: link.trim(), author: author && author.length < 120 ? author.replace(/^por\s+/i, "") : null, published: date };
    })
    .filter((i) => i.title && /^https?:\/\//.test(i.url) && !Number.isNaN(i.published.getTime()));
}

/** Wikidata item and political alignment (P1387) of an outlet, when unambiguous. */
async function outletWikidata(name: string, country: string, countryQid: string | null) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=5&search=${encodeURIComponent(name)}`;
  const res = await fetchJson<{ search?: { id: string }[] }>(url, { ttlHours: 24 * 30 });
  const ids = (res.search ?? []).map((s) => s.id);
  if (!ids.length || !countryQid) return null;
  const rows = await sparql(
    `SELECT ?o ?alLabel WHERE { VALUES ?o { ${ids.map((i) => `wd:${i}`).join(" ")} }
      ?o wdt:P17 wd:${countryQid} .
      VALUES ?cls { wd:Q11032 wd:Q1110794 wd:Q1153191 wd:Q17232649 wd:Q1002697 wd:Q1193236 }
      ?o wdt:P31/wdt:P279? ?cls .
      OPTIONAL { ?o wdt:P1387 ?al }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". } }`,
    { ttlHours: 24 * 30 },
  );
  if (!rows.length) return null;
  const first = qid(rows[0].o)!;
  const al = rows.filter((r) => qid(r.o) === first && r.alLabel && !/^Q\d+$/.test(r.alLabel)).map((r) => r.alLabel);
  return { qid: first, alignment: al.length ? [...new Set(al)].join(", ") : null, country };
}

export const opinionJob: Job = {
  name: "opinion",
  description: "colunas de opinião via RSS (só metadados) + colunistas + palavras-chave",
  async run() {
    // Outlets.
    const countryQids = new Map((await db.select({ code: schema.countries.code, qid: schema.countries.wikidataQid }).from(schema.countries)).map((c) => [c.code.trim(), c.qid]));
    for (const o of OUTLETS) {
      let wd: Awaited<ReturnType<typeof outletWikidata>> = null;
      try {
        wd = await outletWikidata(o.name, o.country, countryQids.get(o.country) ?? null);
      } catch (err) {
        log.warn(`wikidata ${o.name}: ${(err as Error).message}`);
      }
      const values = {
        id: o.id,
        countryCode: o.country,
        name: o.name,
        url: o.url,
        language: o.language,
        kind: o.kind,
        feeds: o.feeds,
        wikidataQid: wd?.qid ?? null,
        alignment: wd?.alignment ?? null,
        sourceId: "rss",
        sourceUrl: o.feeds[0],
        updatedAt: new Date(),
      };
      await db.insert(schema.outlets).values(values).onConflictDoUpdate({ target: schema.outlets.id, set: { ...values, id: undefined } });
    }

    // Feeds.
    let fetched = 0;
    let inserted = 0;
    let failed = 0;
    for (const o of OUTLETS) {
      for (const feed of o.feeds) {
        let items: Item[];
        try {
          items = parseFeed((await fetchCached(feed, { ttlHours: 1, headers: { Accept: "application/rss+xml, application/xml, text/xml" } })).toString("utf8"));
          fetched++;
        } catch (err) {
          failed++;
          log.warn(`feed ${o.id}: ${(err as Error).message}`);
          continue;
        }
        const fresh = items.filter((i) => i.published > new Date(Date.now() - 45 * 864e5) && i.published < new Date(Date.now() + 864e5));
        if (!fresh.length) continue;

        // Columnists = distinct authors per outlet.
        const authors = [...new Set(fresh.map((i) => i.author).filter(Boolean) as string[])];
        const colIds = new Map<string, number>();
        for (const b of chunks(authors, 100)) {
          const rows = await db
            .insert(schema.columnists)
            .values(b.map((name) => ({ name, outletId: o.id, lastSeen: new Date() })))
            .onConflictDoUpdate({ target: [schema.columnists.outletId, schema.columnists.name], set: { lastSeen: new Date() } })
            .returning({ id: schema.columnists.id, name: schema.columnists.name });
          for (const r of rows) colIds.set(r.name, r.id);
        }
        const rows = fresh.map((i) => ({
          outletId: o.id,
          columnistId: i.author ? (colIds.get(i.author) ?? null) : null,
          countryCode: o.country,
          title: i.title.slice(0, 400),
          url: i.url.slice(0, 1000),
          author: i.author,
          publishedAt: i.published,
          language: o.language,
          keyphrases: keyphrases(i.title),
        }));
        for (const b of chunks(rows, 100)) {
          const r = await db.insert(schema.articles).values(b).onConflictDoNothing().returning({ id: schema.articles.id });
          inserted += r.length;
        }
      }
    }
    // Article counts per columnist.
    await db.execute(sql`update columnists c set articles = (select count(*) from articles a where a.columnist_id = c.id)`);

    // Feed events: columnists' pieces are many; flag only outlets' busiest new theme later (themes job).
    await touchSource("rss");
    return { outlets: OUTLETS.length, feedsFetched: fetched, feedsFailed: failed, newArticles: inserted };
  },
};

/** Theme trends per country: last 7 days vs the 21 days before, from model themes and headline keyphrases. */
export const themesJob: Job = {
  name: "themes",
  description: "temas em alta por país (últimos 7 dias vs 21 anteriores) + teses que ganham tração",
  async run() {
    const since = new Date(Date.now() - 28 * 864e5);
    const arts = await db
      .select({ id: schema.articles.id, country: schema.articles.countryCode, at: schema.articles.publishedAt, theme: schema.articles.theme, kp: schema.articles.keyphrases })
      .from(schema.articles)
      .where(gte(schema.articles.publishedAt, since));
    const cut = Date.now() - 7 * 864e5;
    type Acc = { label: string; recent: number; previous: number; samples: number[] };
    const by = new Map<string, Map<string, Acc>>();
    const bump = (country: string, label: string, recent: boolean, id: number) => {
      const key = norm(label);
      if (key.length < 3) return;
      const m = by.get(country) ?? new Map<string, Acc>();
      by.set(country, m);
      const a = m.get(key) ?? { label, recent: 0, previous: 0, samples: [] };
      if (recent) a.recent++;
      else a.previous++;
      if (recent && a.samples.length < 5) a.samples.push(id);
      m.set(key, a);
    };
    for (const a of arts) {
      const recent = a.at.getTime() >= cut;
      const labels = new Set([...(a.theme ? [a.theme] : []), ...(a.kp ?? []).slice(0, 4)]);
      for (const l of labels) {
        bump(a.country.trim(), l, recent, a.id);
        bump("WLD", l, recent, a.id);
      }
    }
    const rows: (typeof schema.themeTrends.$inferInsert)[] = [];
    for (const [country, m] of by) {
      const top = [...m.values()]
        .filter((a) => a.recent + a.previous >= (country === "WLD" ? 6 : 3))
        .map((a) => {
          // Previous window is 3× longer: compare weekly rates.
          const prevRate = a.previous / 3;
          const trend = a.previous === 0 ? "new" : a.recent > prevRate * 1.5 + 1 ? "rising" : a.recent < prevRate * 0.5 ? "falling" : "stable";
          return { a, trend, score: a.recent * 2 + a.previous / 3 };
        })
        .sort((x, y) => y.score - x.score)
        .slice(0, country === "WLD" ? 40 : 15);
      for (const t of top)
        rows.push({ countryCode: country, theme: t.a.label.slice(0, 120), recent: t.a.recent, previous: t.a.previous, trend: t.trend, sampleArticleIds: t.a.samples, computedAt: new Date() });
    }
    await db.transaction(async (tx) => {
      await tx.delete(schema.themeTrends);
      for (const b of chunks(rows, 300)) await tx.insert(schema.themeTrends).values(b).onConflictDoNothing();
    });

    // Feed: rising themes with real volume become events (once per theme per week).
    const week = Math.floor(Date.now() / (7 * 864e5));
    const names = new Map((await db.select({ code: schema.countries.code, name: schema.countries.namePt }).from(schema.countries)).map((c) => [c.code.trim(), c.name]));
    for (const r of rows.filter((r) => r.trend === "rising" && r.recent >= 4 && r.countryCode !== "WLD").slice(0, 20)) {
      await db
        .insert(schema.events)
        .values({
          type: "theme_rising",
          countryCode: r.countryCode,
          occurredAt: new Date(),
          title: `${names.get(r.countryCode) ?? r.countryCode}: “${r.theme}” ganha tração nas colunas (${r.recent} em 7 dias)`,
          payload: { theme: r.theme, recent: r.recent, previous: r.previous },
          dedupeKey: `theme:${r.countryCode}:${norm(r.theme)}:${week}`,
          sourceId: "rss",
        })
        .onConflictDoNothing();
    }
    // Theses mentioned again recently gain traction too.
    const hot = await db
      .select()
      .from(schema.theses)
      .where(and(gte(schema.theses.lastSeen, new Date(cut)), gte(schema.theses.mentions, 3)));
    for (const t of hot.slice(0, 10)) {
      await db
        .insert(schema.events)
        .values({
          type: "thesis_rising",
          countryCode: t.countryCode,
          occurredAt: t.lastSeen,
          title: `${names.get(t.countryCode.trim()) ?? t.countryCode}: tese em circulação — “${t.text.slice(0, 120)}”`,
          payload: { thesisId: t.id, mentions: t.mentions },
          dedupeKey: `thesis:${t.id}:${week}`,
          sourceId: "atlas-ai",
        })
        .onConflictDoNothing();
    }
    return { articles28d: arts.length, themeRows: rows.length };
  },
};

