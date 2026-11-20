import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const dynamic = "force-static";

export type RecentSignalRow = [
  platform: string,
  countryCode: string,
  title: string,
  author: string | null,
  url: string,
  publishedAt: string,
  metric: number | null,
  econ: number | null,
];

/**
 * Compact static index of recent political signals (X voices, YouTube, news, Reddit, X trends)
 * rebuilt every hour so the client-side AI dossier search can cite live discussions on any topic.
 */
export async function GET() {
  const rows = (await db.execute(sql`
    with ranked as (
      select
        platform,
        trim(country_code) as country_code,
        title,
        author,
        url,
        published_at,
        metric,
        econ,
        row_number() over (
          partition by platform, trim(country_code)
          order by
            coalesce(metric::numeric, 0) desc,
            published_at desc
        ) as rn
      from signals
      where greatest(published_at, seen_at) > now() - interval '7 days'
        and length(title) >= 4
    )
    select platform, country_code, title, author, url, published_at, metric, econ
    from ranked
    where (platform = 'x-voice' and rn <= 250)
       or (platform = 'youtube' and rn <= 40)
       or (platform = 'news' and rn <= 35)
       or (platform = 'reddit' and rn <= 20)
       or (platform = 'x' and rn <= 15)
    order by published_at desc
    limit 4500
  `)) as unknown as {
    platform: string;
    country_code: string;
    title: string;
    author: string | null;
    url: string;
    published_at: Date;
    metric: string | null;
    econ: string | null;
  }[];

  const compact: RecentSignalRow[] = rows.map((r) => [
    r.platform,
    r.country_code,
    r.title.slice(0, 260),
    r.author ? r.author.slice(0, 80) : null,
    r.platform === "x" ? r.url.replace(/#.*$/, "") : r.url,
    new Date(r.published_at).toISOString().slice(0, 16),
    r.metric == null ? null : Math.round(Number(r.metric)),
    r.econ == null ? null : Math.round(Number(r.econ) * 100) / 100,
  ]);

  return Response.json({ generatedAt: new Date().toISOString(), rows: compact });
}
