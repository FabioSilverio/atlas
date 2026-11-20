import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import type { Pulse, PulseItem, PulseSide, PulseTerm } from "@/lib/db/schema";
import { touchSource, type Job } from "../lib/job";
import { fold, sideOf, weightOf, youtubeId } from "../lib/monitor";
import { chunks } from "../lib/wiki";

type Row = {
  platform: string; title: string; url: string; author: string | null; channel_id: string | null; published_at: Date; seen_at: Date;
  metric: string | null; metric_kind: string | null; terms: string[]; actor_ids: number[]; econ: string | null; owner_kind: string | null;
};

const H = 3.6e6;
const PLATFORMS = ["news", "x", "reddit", "youtube", "x-voice"];
// Words too generic to be "the talk of the day" on their own.
const GENERIC = new Set(
  ("governo government gobierno gouvernement regierung presidente president ministro minister brasil brazil hoje today ontem semana week anos years novo nova new contra against pode should diz says afirma said sobre about pais country nacional national " +
    "politica politico politicos politics political politique politik polityka politika siyaset " +
    "ao vivo live en vivo en direct direkt video videos noticias noticia news breaking update updates watch full episode podcast entrevista interview commentary opinion analysis analise analisis editorial " +
    "relatorio report reporte rapport bericht").split(" "),
);

// Phrases made only of generic words ("ao vivo", "breaking news").
const GENERIC_RE = /^(ao vivo|en vivo|en direct|live|breaking news|ultimas noticias|ultima hora|direto|aovivo)$/;

/**
 * The pulse of each country, from the monitor's signals:
 *  · who dominates the conversation — share of attention on items that mention
 *    left, centre or right actors (by the actors' academic positions), per platform
 *    and overall (platforms weigh the same), last 3 days against the 7 before;
 *  · the terms rising now, with their top headlines and most-viewed videos;
 *  · X trends, top Reddit posts and the most-viewed political videos.
 * Mentioning is not supporting: the page says so next to the numbers.
 */
export const pulseJob: Job = {
  name: "pulse",
  description: "pulso por país: termômetro de atenção por lado, termos em alta, vídeos, X e Reddit",
  async run() {
    const countries = (await db.execute(sql`select distinct country_code as code from signals`)) as unknown as { code: string }[];
    const now = Date.now();
    const rowsOut: { countryCode: string; data: Pulse; computedAt: Date }[] = [];
    const history: (typeof schema.pulseHistory.$inferInsert)[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const { code: raw } of countries) {
      const code = raw.trim();
      const rows = (await db.execute(sql`
        select s.platform, s.title, s.url, s.author, s.channel_id, s.published_at, s.seen_at, s.metric, s.metric_kind, s.terms, s.actor_ids, s.econ, c.owner_kind
        from signals s left join channels c on c.channel_id = s.channel_id
        where s.country_code = ${code} and greatest(s.published_at, s.seen_at) > now() - interval '10 days'`)) as unknown as Row[];
      if (!rows.length) continue;
      const age = (r: Row) => (now - new Date(r.platform === "x" || r.platform === "news" ? r.seen_at : r.published_at).getTime()) / H;
      const pubAge = (r: Row) => (now - new Date(r.published_at).getTime()) / H;
      const metric = (r: Row) => (r.metric == null ? null : Number(r.metric));
      const item = (r: Row): PulseItem => ({
        title: r.title, url: r.platform === "x" ? r.url.replace(/#.*$/, "") : r.url, author: r.author, platform: r.platform, metric: metric(r), metricKind: r.metric_kind,
        publishedAt: new Date(r.published_at).toISOString(), econ: r.econ == null ? null : Number(r.econ), videoId: r.platform === "youtube" ? (youtubeId(r.url) ?? undefined) : undefined,
      });

      // ── Thermometer ──
      const side = (list: Row[]): PulseSide => {
        const acc = { left: 0, center: 0, right: 0 };
        let w = 0;
        let m = 0;
        for (const r of list) {
          if (r.econ == null) continue;
          const wt = weightOf(r.platform, metric(r));
          acc[sideOf(Number(r.econ))] += wt;
          w += wt;
          m += wt * Number(r.econ);
        }
        const n = list.filter((r) => r.econ != null).length;
        return w ? { left: round(acc.left / w), center: round(acc.center / w), right: round(acc.right / w), n, mean: round(m / w) } : { left: 0, center: 0, right: 0, n: 0, mean: null };
      };
      const combine = (parts: PulseSide[]): PulseSide => {
        const ok = parts.filter((p) => p.n >= 5);
        if (!ok.length) return { left: 0, center: 0, right: 0, n: 0, mean: null };
        const avg = (k: "left" | "center" | "right") => round(ok.reduce((s, p) => s + p[k], 0) / ok.length);
        return { left: avg("left"), center: avg("center"), right: avg("right"), n: ok.reduce((s, p) => s + p.n, 0), mean: round(ok.reduce((s, p) => s + p.mean!, 0) / ok.length) };
      };
      const recent = rows.filter((r) => age(r) <= 72);
      const before = rows.filter((r) => age(r) > 72 && age(r) <= 240);
      const byPlatform: Record<string, PulseSide> = {};
      for (const p of PLATFORMS) {
        const s = side(recent.filter((r) => r.platform === p));
        if (s.n) byPlatform[p] = s;
      }
      const overall = combine(Object.values(byPlatform));
      const prevParts = PLATFORMS.map((p) => side(before.filter((r) => r.platform === p)));
      const previous = combine(prevParts);
      const ytParty = recent.filter((r) => r.platform === "youtube" && (r.owner_kind === "party" || r.owner_kind === "politician") && pubAge(r) <= 168);
      const youtubeChannels = ytParty.length >= 5 ? sideByMetric(ytParty) : null;

      // ── Terms rising now (last 24h vs the 3 days before, per day) ──
      const termItems = new Map<string, { label: string; now: Row[]; before: number }>();
      for (const r of rows) {
        const a = r.platform === "youtube" ? pubAge(r) : age(r);
        const isNow = a <= (r.platform === "youtube" ? 72 : 24);
        const isBefore = !isNow && a <= 96;
        if (!isNow && !isBefore) continue;
        for (const t of new Set(r.terms)) {
          const k = fold(t.replace(/^#/, ""));
          if (GENERIC_RE.test(k)) continue;
          if (k.length < 3 || GENERIC.has(k)) continue;
          const e = termItems.get(k) ?? { label: t.replace(/^#/, ""), now: [], before: 0 };
          if (isNow) e.now.push(r);
          else e.before++;
          termItems.set(k, e);
        }
      }
      const terms: PulseTerm[] = [...termItems.values()]
        .filter((t) => new Set(t.now.map((r) => r.author ?? r.platform)).size >= 2) // said by at least two sources
        .map((t) => {
          const perDayBefore = t.before / 3;
          return { t, score: t.now.length * Math.log2(2 + t.now.length / (perDayBefore + 1)) };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map(({ t }) => {
          const platforms: Record<string, number> = {};
          for (const r of t.now) platforms[r.platform] = (platforms[r.platform] ?? 0) + 1;
          const lean = side(t.now);
          const top = [
            ...t.now.filter((r) => r.platform === "youtube").sort((a, b) => (metric(b) ?? 0) - (metric(a) ?? 0)).slice(0, 3),
            ...t.now.filter((r) => r.platform !== "youtube" && r.platform !== "x").sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at)).slice(0, 4),
          ];
          return { term: t.label, count: t.now.length, previous: t.before, platforms, econ: lean.mean, items: top.map(item) };
        });
      const topTermKeys = new Set(terms.map((t) => fold(t.term)));

      // ── Highlights ──
      const videos = rows
        .filter((r) => r.platform === "youtube" && pubAge(r) <= 72 && (r.owner_kind === "party" || r.owner_kind === "politician" || r.owner_kind === "voice" || r.actor_ids.length > 0 || r.terms.some((t) => topTermKeys.has(fold(t)))))
        .sort((a, b) => (metric(b) ?? 0) - (metric(a) ?? 0))
        .slice(0, 12)
        .map(item);
      const xNow = rows.filter((r) => r.platform === "x" && age(r) <= 3);
      const xTrends = xNow
        .sort((a, b) => (metric(b) ?? 0) - (metric(a) ?? 0))
        .slice(0, 20)
        .map((r) => ({ term: r.title, volume: r.metric_kind === "posts" ? metric(r) : null, url: r.url.replace(/#.*$/, ""), political: r.actor_ids.length > 0 || topTermKeys.has(fold(r.title.replace(/^#/, ""))) }));
      const reddit = rows.filter((r) => r.platform === "reddit" && pubAge(r) <= 36).sort((a, b) => (metric(b) ?? 0) - (metric(a) ?? 0)).slice(0, 8).map(item);
      const headlines = rows
        .filter((r) => r.platform === "news" && pubAge(r) <= 24)
        .sort((a, b) => Number(b.actor_ids.length > 0) - Number(a.actor_ids.length > 0) || +new Date(b.published_at) - +new Date(a.published_at))
        .slice(0, 10)
        .map(item);
      const voices = rows.filter((r) => r.platform === "x-voice" && pubAge(r) <= 168).sort((a, b) => (metric(b) ?? 0) - (metric(a) ?? 0)).slice(0, 12).map(item);
      const counts: Record<string, number> = {};
      for (const r of recent) counts[r.platform] = (counts[r.platform] ?? 0) + 1;

      const data: Pulse = { window: "72h", overall, previous: previous.n ? previous : null, byPlatform, youtubeChannels, terms, videos, xTrends, reddit, headlines, voices, counts };
      rowsOut.push({ countryCode: code, data, computedAt: new Date() });
      if (overall.n) history.push({ countryCode: code, day: today, left: String(overall.left), center: String(overall.center), right: String(overall.right), mean: overall.mean == null ? null : String(overall.mean), n: overall.n });
    }

    await db.transaction(async (tx) => {
      await tx.delete(schema.pulse);
      for (const b of chunks(rowsOut, 50)) await tx.insert(schema.pulse).values(b);
      for (const b of chunks(history, 200))
        await tx.insert(schema.pulseHistory).values(b).onConflictDoUpdate({
          target: [schema.pulseHistory.countryCode, schema.pulseHistory.day],
          set: { left: sql`excluded.left`, center: sql`excluded.center`, right: sql`excluded.right`, mean: sql`excluded.mean`, n: sql`excluded.n` },
        });
    });
    await touchSource("atlas-pulse");
    return { countries: rowsOut.length, withThermometer: history.length };
  },
};

const round = (n: number) => Math.round(n * 1000) / 1000;

/** View share by side of party and politician channels (the channel owner's side). */
function sideByMetric(list: Row[]): PulseSide {
  const acc = { left: 0, center: 0, right: 0 };
  let total = 0;
  let m = 0;
  for (const r of list) {
    if (r.econ == null) continue;
    const v = Number(r.metric ?? 0);
    acc[sideOf(Number(r.econ))] += v;
    total += v;
    m += v * Number(r.econ);
  }
  return total ? { left: round(acc.left / total), center: round(acc.center / total), right: round(acc.right / total), n: list.length, mean: round(m / total) } : { left: 0, center: 0, right: 0, n: 0, mean: null };
}
