import { XMLParser } from "fast-xml-parser";
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchCached } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { keyphrases } from "../lib/keyphrases";
import { log } from "../lib/log";
import { getState, setState } from "../lib/state";
import { chunks } from "../lib/wiki";

// Countries without a tracked opinion section get commentary and analysis about
// them from Google News search (English edition): headline, source outlet, date
// and link only. A slice of countries per run keeps each run short.
const PER_RUN = process.env.VERCEL ? 60 : 400;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });
const txt = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v));

export const newsJob: Job = {
  name: "news",
  description: "análise e opinião sobre países sem feed próprio (Google News, só metadados)",
  async run() {
    const countries = (await db.execute(sql`
      select c.code, c.name_en from countries c
      where c.ne_type in ('Sovereign country', 'Country')
        and not exists (select 1 from outlets o where o.country_code = c.code and o.kind <> 'aggregator')
      order by c.code`)) as unknown as { code: string; name_en: string }[];
    const cursor = await getState<number>("news.cursor", 0);
    const slice = Array.from({ length: Math.min(PER_RUN, countries.length) }, (_, k) => countries[(cursor + k) % countries.length]);
    await setState("news.cursor", (cursor + slice.length) % Math.max(1, countries.length));

    let inserted = 0;
    let failed = 0;
    for (const c of slice) {
      const code = c.code.trim();
      const q = `"${c.name_en}" (opinion OR analysis OR editorial OR commentary) when:14d`;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
      const outletId = `gn-${code.toLowerCase()}`;
      await db
        .insert(schema.outlets)
        .values({ id: outletId, countryCode: code, name: "Google News (busca)", url: "https://news.google.com", language: "en", kind: "aggregator", feeds: [url], sourceId: "google-news", sourceUrl: url })
        .onConflictDoUpdate({ target: schema.outlets.id, set: { feeds: [url], updatedAt: new Date() } });
      let items: Record<string, unknown>[];
      try {
        const doc = parser.parse((await fetchCached(url, { ttlHours: 6 })).toString("utf8"));
        const raw = doc.rss?.channel?.item ?? [];
        items = Array.isArray(raw) ? raw : [raw];
      } catch (err) {
        failed++;
        log.warn(`google news ${code}: ${(err as Error).message}`);
        continue;
      }
      const seen = new Set<string>();
      const rows = items
        .map((it) => {
          const source = txt(it.source);
          // Titles come as "Headline - Outlet".
          const title = txt(it.title).replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
          return { title, url: txt(it.link), source, published: new Date(txt(it.pubDate)) };
        })
        .filter((i) => i.title && i.url && !Number.isNaN(i.published.getTime()) && !seen.has(i.url) && (seen.add(i.url), true))
        .slice(0, 40)
        .map((i) => ({
          outletId,
          countryCode: code,
          title: i.title.slice(0, 400),
          url: i.url.slice(0, 1000),
          author: i.source || null, // the original outlet
          publishedAt: i.published,
          language: "en",
          keyphrases: keyphrases(i.title).filter((k) => k.toLowerCase() !== c.name_en.toLowerCase()),
        }));
      for (const b of chunks(rows, 100)) {
        const r = await db.insert(schema.articles).values(b).onConflictDoNothing().returning({ id: schema.articles.id });
        inserted += r.length;
      }
    }
    await touchSource("google-news");
    return { countriesWithoutFeeds: countries.length, processed: slice.length, failed, newArticles: inserted };
  },
};
