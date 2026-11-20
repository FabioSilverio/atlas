import { XMLParser } from "fast-xml-parser";
import { lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { fetchCached, USER_AGENT } from "../lib/http";
import { touchSource, type Job } from "../lib/job";
import { keyphrases } from "../lib/keyphrases";
import { log } from "../lib/log";
import { actorMatcher, GNEWS_EDITIONS, leanOf, type ActorRef } from "../lib/monitor";
import { qid, sparql } from "../lib/sparql";
import { getState, setState } from "../lib/state";
import { chunks } from "../lib/wiki";
import voices from "@/data/seed/voices.json";
import type { Voice } from "./channels";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", textNodeName: "#text" });
const txt = (v: unknown): string => (v == null ? "" : typeof v === "object" ? String((v as Record<string, unknown>)["#text"] ?? "") : String(v));
const arr = <T,>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const KEEP_DAYS = 30;
const YT_PER_RUN = Number(process.env.MONITOR_YT_PER_RUN ?? 900);
const YT_REFRESH_HOURS = 3;

type YtEntry = { published?: string; title?: string; "yt:videoId"?: string; "media:group"?: { "media:community"?: { "media:statistics"?: { "@views"?: string } } } };
type Country = { code: string; iso2: string | null; name_en: string; qid: string | null };
type Signal = typeof schema.signals.$inferInsert;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

/**
 * Hourly monitor. Collects, per country, what is being said about politics:
 * national headlines (Google News editions), X trends (trends24.in), YouTube
 * videos of parties, politicians and news media (public channel feeds, with view
 * counts), and the day's top posts in national subreddits. Metadata only.
 * Each item is tagged with the political actors it mentions; its side is the
 * mean academic position of those actors (or of the channel owner's party).
 */
export const monitorJob: Job = {
  name: "monitor",
  description: "monitor horário: manchetes nacionais, tendências do X, YouTube e Reddit por país",
  async run() {
    const countries = (await db.execute(sql`
      select code, iso2, name_en, wikidata_qid as qid from countries where ne_type in ('Sovereign country', 'Country') order by code`)) as unknown as Country[];
    for (const c of countries) c.code = c.code.trim();
    const actorRows = (await db.execute(sql`select id, country_code, name, aliases, econ, party_label from actors`)) as unknown as {
      id: number; country_code: string; name: string; aliases: string[]; econ: string | null; party_label: string | null;
    }[];
    const actorsBy = new Map<string, ActorRef[]>();
    for (const a of actorRows) {
      const code = a.country_code.trim();
      actorsBy.set(code, [...(actorsBy.get(code) ?? []), { id: a.id, name: a.name, aliases: a.aliases, econ: a.econ == null ? null : Number(a.econ), partyLabel: a.party_label }]);
    }
    const matchers = new Map([...actorsBy].map(([k, v]) => [k, actorMatcher(v)]));
    const tag = (code: string, title: string) => {
      const hits = matchers.get(code)?.find(title) ?? [];
      const lean = leanOf(hits);
      return { actorIds: hits.map((h) => h.id), econ: lean.econ == null ? null : String(lean.econ), leanBasis: lean.basis };
    };
    const hour = new Date().getUTCHours();
    const stats: Record<string, number> = {};
    const bump = (k: string, n = 1) => (stats[k] = (stats[k] ?? 0) + n);
    const out: Signal[] = [];

    // ── 1. Headlines ─────────────────────────────────────────────
    const newsTasks: { code: string; url: string; lang: string; drop?: string }[] = [];
    for (const c of countries) {
      const ed = c.iso2 ? GNEWS_EDITIONS[c.iso2] : undefined;
      if (ed) {
        const [hl, ceid, politics] = ed;
        const qs = `hl=${hl}&gl=${c.iso2}&ceid=${ceid}`;
        newsTasks.push({ code: c.code, url: `https://news.google.com/rss/headlines/section/topic/NATION?${qs}`, lang: hl });
        if (hour % 3 === 0) newsTasks.push({ code: c.code, url: `https://news.google.com/rss/search?q=${encodeURIComponent(`${politics} when:1d`)}&${qs}`, lang: hl });
      } else if (hash(c.code) % 3 === hour % 3) {
        // Without a national edition: English coverage of the country's politics, a third of them per hour.
        newsTasks.push({ code: c.code, url: `https://news.google.com/rss/search?q=${encodeURIComponent(`"${c.name_en}" (politics OR government OR election OR president OR minister) when:2d`)}&hl=en-US&gl=US&ceid=US:en`, lang: "en", drop: c.name_en });
      }
    }
    await pool(newsTasks, 3, async (t) => {
      try {
        const doc = parser.parse((await fetchCached(t.url, { ttlHours: 0.5 })).toString("utf8"));
        for (const it of arr(doc.rss?.channel?.item).slice(0, 60) as Record<string, unknown>[]) {
          const source = txt(it.source);
          const title = txt(it.title).replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
          const published = new Date(txt(it.pubDate));
          if (!title || Number.isNaN(published.getTime())) continue;
          out.push({
            countryCode: t.code, platform: "news", title: title.slice(0, 400), url: txt(it.link).slice(0, 1000), author: source || null, publishedAt: published,
            terms: keyphrases(title).filter((k) => !t.drop || k.toLowerCase() !== t.drop.toLowerCase()), sourceId: "google-news-editions", ...tag(t.code, title),
          });
          bump("news");
        }
      } catch (err) {
        bump("newsFailed");
        log.warn(`notícias ${t.code}: ${(err as Error).message}`);
      }
    });

    log.info(`monitor: manchetes ${stats.news ?? 0}`);
    // ── 2. X trends (trends24.in) ────────────────────────────────
    const slugs = await xSlugs(countries);
    await pool([...slugs], 2, async ([code, slug]) => {
      try {
        const html = (await fetchCached(`https://trends24.in/${slug}/`, { ttlHours: 0.75 })).toString("utf8");
        // The first list is the latest hour; keep its top 30.
        const first = html.split("<ol class=trend-card__list>")[1]?.split("</ol>")[0] ?? "";
        const stamp = Number(html.match(/data-timestamp=([\d.]+)/)?.[1]);
        const at = Number.isFinite(stamp) ? new Date(stamp * 1000) : new Date();
        let rank = 0;
        for (const m of first.matchAll(/<a href="([^"]+)" class=trend-link>([^<]+)<\/a>(?:<span class=tweet-count data-count=(\d*)>)?/g)) {
          rank++;
          if (rank > 30) break;
          const term = decodeHtml(m[2]).trim();
          out.push({
            countryCode: code, platform: "x", title: term, url: `https://x.com/search?q=${encodeURIComponent(term)}#${at.toISOString().slice(0, 10)}`, author: "trends24.in",
            publishedAt: at, metric: m[3] ? m[3] : String(31 - rank), metricKind: m[3] ? "posts" : "rank", terms: [term.replace(/^#/, "")], sourceId: "x-trends", ...tag(code, term.replace(/^#/, "").replace(/([a-z])([A-Z])/g, "$1 $2")),
          });
          bump("x");
        }
      } catch (err) {
        bump("xFailed");
        log.warn(`tendências X ${code}: ${(err as Error).message}`);
      }
    });

    log.info(`monitor: tendências do X ${stats.x ?? 0} em ${slugs.size} países`);
    // ── 3. YouTube channel feeds (rotation: each channel every few hours) ──
    const due = (await db.execute(sql`
      select channel_id, country_code, owner_name, owner_kind, econ, lean_basis from channels
      where checked_at is null or checked_at < now() - make_interval(hours => ${YT_REFRESH_HOURS})
      order by checked_at nulls first limit ${YT_PER_RUN}`)) as unknown as { channel_id: string; country_code: string; owner_name: string; owner_kind: string; econ: string | null; lean_basis: string | null }[];
    const checked: string[] = [];
    await pool(due, 6, async (ch) => {
      const code = ch.country_code.trim();
      try {
        const doc = parser.parse((await fetchCached(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.channel_id}`, { ttlHours: 1 })).toString("utf8"));
        for (const e of arr(doc.feed?.entry) as YtEntry[]) {
          const published = new Date(txt(e.published));
          if (Number.isNaN(published.getTime()) || Date.now() - published.getTime() > 14 * 864e5) continue;
          const title = txt(e.title);
          const views = Number(e["media:group"]?.["media:community"]?.["media:statistics"]?.["@views"]);
          const mention = tag(code, title);
          // A party or politician channel speaks for its side; a news channel only through whom it mentions.
          const own = ch.econ != null ? { econ: ch.econ, leanBasis: ch.lean_basis } : { econ: mention.econ, leanBasis: mention.leanBasis };
          out.push({
            countryCode: code, platform: "youtube", title: title.slice(0, 400), url: `https://www.youtube.com/watch?v=${txt(e["yt:videoId"])}`, author: ch.owner_name,
            channelId: ch.channel_id, publishedAt: published, metric: Number.isFinite(views) ? String(views) : null, metricKind: "views",
            terms: keyphrases(title), sourceId: "youtube", actorIds: mention.actorIds, ...own,
          });
          bump("youtube");
        }
        checked.push(ch.channel_id);
      } catch (err) {
        bump("youtubeFailed");
        if (/HTTP 404/.test((err as Error).message)) checked.push(ch.channel_id); // removed channel: retry later
      }
    });
    for (const b of chunks(checked, 500)) await db.execute(sql`update channels set checked_at = now() where channel_id in ${sql.raw(`(${b.map((id) => `'${id.replace(/'/g, "")}'`).join(",")})`)}`);

    log.info(`monitor: vídeos ${stats.youtube ?? 0} de ${checked.length} canais`);
    // ── 4. Reddit (national subreddits from Wikidata P3984) ──────
    const subs = await subreddits(countries);
    let redditBlocked = 0;
    let redditTried = 0;
    await pool(subs, 1, async ([code, sub]) => {
      // Reddit blocks many automated clients outright: stop after three refusals in a row.
      if (redditTried >= 3 && redditBlocked === redditTried) return;
      redditTried++;
      try {
        const res = await fetch(`https://www.reddit.com/r/${sub}/top.json?t=day&limit=25&raw_json=1`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
        if (res.status === 403 || res.status === 429 || res.status === 404) {
          redditBlocked++;
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data?: { children?: { data: { title: string; permalink: string; score: number; created_utc: number; num_comments: number } }[] } };
        for (const { data: p } of json.data?.children ?? []) {
          out.push({
            countryCode: code, platform: "reddit", title: p.title.slice(0, 400), url: `https://www.reddit.com${p.permalink}`, author: `r/${sub}`,
            publishedAt: new Date(p.created_utc * 1000), metric: String(p.score), metricKind: "score", terms: keyphrases(p.title), sourceId: "reddit", ...tag(code, p.title),
          });
          bump("reddit");
        }
        await new Promise((r) => setTimeout(r, 2000));
      } catch (err) {
        bump("redditFailed");
        log.warn(`reddit r/${sub}: ${(err as Error).message}`);
      }
    });
    if (redditBlocked) stats.redditBlocked = redditBlocked;

    // ── 5. Curated voices on X (FxTwitter's public API; the official API if a token is set) ──
    await xVoices(out, tag, bump);

    // Write: new items are inserted; known ones get their metric (views, score) updated.
    const seen = new Set<string>();
    const rows = out.filter((r) => r.url && !seen.has(`${r.platform}|${r.countryCode}|${r.url}`) && (seen.add(`${r.platform}|${r.countryCode}|${r.url}`), true));
    for (const b of chunks(rows, 400))
      await db.insert(schema.signals).values(b).onConflictDoUpdate({
        target: [schema.signals.platform, schema.signals.countryCode, schema.signals.url],
        set: { metric: sql`excluded.metric`, econ: sql`excluded.econ`, leanBasis: sql`excluded.lean_basis`, actorIds: sql`excluded.actor_ids`, seenAt: sql`now()` },
      });
    await db.delete(schema.signals).where(lt(schema.signals.publishedAt, new Date(Date.now() - KEEP_DAYS * 864e5)));
    for (const s of ["google-news-editions", "x-trends", "youtube", "reddit"]) await touchSource(s);
    return { ...stats, written: rows.length, channelsChecked: checked.length, xCountries: slugs.size, subreddits: subs.length };
  },
};

const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);
const decodeHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** trends24 country pages, discovered once a week from the countries' English names. */
async function xSlugs(countries: Country[]): Promise<Map<string, string>> {
  const cached = await getState<{ at: string; slugs: [string, string][] } | null>("monitor.xSlugs", null);
  if (cached && Date.now() - new Date(cached.at).getTime() < 7 * 864e5) return new Map(cached.slugs);
  const found: [string, string][] = [];
  await pool(countries, 2, async (c) => {
    const slug = c.name_en.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
    for (const s of [slug, ...(SLUG_ALIASES[c.code] ?? [])]) {
      try {
        const res = await fetch(`https://trends24.in/${s}/`, { method: "HEAD", headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
        if (res.ok) {
          found.push([c.code, s]);
          return;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 700));
    }
  });
  await setState("monitor.xSlugs", { at: new Date().toISOString(), slugs: found });
  return new Map(found);
}
const SLUG_ALIASES: Record<string, string[]> = { USA: ["united-states"], GBR: ["united-kingdom"], KOR: ["korea"], ARE: ["united-arab-emirates"], RUS: ["russia"], DOM: ["dominican-republic"], CZE: ["czech-republic"] };

/** National subreddits (Wikidata P3984 on the country item), refreshed weekly. */
async function subreddits(countries: Country[]): Promise<[string, string][]> {
  const cached = await getState<{ at: string; subs: [string, string][] } | null>("monitor.subreddits", null);
  if (cached && Date.now() - new Date(cached.at).getTime() < 7 * 864e5) return cached.subs;
  const byQid = new Map(countries.filter((c) => c.qid).map((c) => [c.qid!, c.code]));
  const subs: [string, string][] = [];
  for (const b of chunks([...byQid.keys()], 120)) {
    try {
      const res = await sparql(`SELECT ?c ?s WHERE { VALUES ?c { ${b.map((q) => `wd:${q}`).join(" ")} } ?c wdt:P3984 ?s }`, { ttlHours: 24 * 7 });
      for (const r of res) subs.push([byQid.get(qid(r.c)!)!, r.s]);
    } catch (err) {
      log.warn(`subreddits: ${(err as Error).message}`);
    }
  }
  await setState("monitor.subreddits", { at: new Date().toISOString(), subs });
  return subs;
}

type FxStatus = { id: string; url: string; text: string; created_timestamp: number; likes: number; reposts: number; replies: number; quotes?: number; views?: number; author?: { screen_name: string } };

/**
 * Recent posts of the editor-curated voices. Read through FxTwitter's public API
 * (api.fxtwitter.com, the service behind fixupx.com embeds), which answers
 * intermittently: an account that fails now is simply tried again next hour,
 * and what was collected stays for 30 days. Only the account's own posts count.
 */
async function xVoices(out: Signal[], tag: (code: string, t: string) => { actorIds: number[]; econ: string | null; leanBasis: string | null }, bump: (k: string, n?: number) => void) {
  for (const v of (voices as Voice[]).filter((v) => v.x)) {
    try {
      const res = await fetch(`https://api.fxtwitter.com/2/profile/${v.x}/statuses`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) {
        bump("xVoicesUnavailable");
        continue;
      }
      const { results = [] } = (await res.json()) as { results?: FxStatus[] };
      for (const p of results.filter((p) => p.author?.screen_name?.toLowerCase() === v.x!.toLowerCase())) {
        const engagement = p.likes + 2 * p.reposts + p.replies + (p.quotes ?? 0);
        out.push({
          countryCode: v.country, platform: "x-voice", title: p.text.replace(/\s+/g, " ").slice(0, 400), url: `https://x.com/${v.x}/status/${p.id}`,
          author: `${v.name} (@${v.x}) · ${v.camp}`, publishedAt: new Date(p.created_timestamp * 1000), metric: String(engagement), metricKind: "engajamento",
          terms: keyphrases(p.text), sourceId: "fxtwitter", ...tag(v.country, p.text),
        });
        bump("xVoices");
      }
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      bump("xVoicesFailed");
      log.warn(`X @${v.x}: ${(err as Error).message}`);
    }
  }
}
