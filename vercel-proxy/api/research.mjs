// On-demand live web scraper for ATLAS /busca?q=... (YouTube, X, Reddit, News, Wikipedia).
// Only runs when a user explicitly submits a search query; cached 15 min at Vercel's edge.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const ATLAS_UA = "ATLAS/0.1 (https://github.com/FabioSilverio/atlas)";

const decodeHtml = (s = "") =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function parseViewNum(text = "") {
  const s = text.toLowerCase().replace(/\s+/g, " ");
  const m = s.match(/([\d.,]+)\s*(mi|m\b|mil|k\b|bi|b\b)?/);
  if (!m) return null;
  let n = Number(m[1].replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const u = m[2] || "";
  if (u.startsWith("bi") || u === "b") n *= 1e9;
  else if (u.startsWith("mi") || u === "m") n *= 1e6;
  else if (u === "mil" || u === "k") n *= 1e3;
  return Math.round(n);
}

async function searchYouTube(q) {
  // Fetch both most-viewed (CAMSAhAB) and most-relevant searches in parallel.
  const urls = [
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAMSAhAB`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  ];
  const seen = new Set();
  const out = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return;
        const html = await res.text();
        const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
        if (!m) return;
        const data = JSON.parse(m[1]);
        const walk = (o) => {
          if (!o || typeof o !== "object") return;
          if (o.videoRenderer?.videoId) {
            const v = o.videoRenderer;
            if (!seen.has(v.videoId)) {
              seen.add(v.videoId);
              const title = v.title?.runs?.map((x) => x.text).join("") ?? "";
              const channel = v.ownerText?.runs?.[0]?.text ?? null;
              const viewsText = v.viewCountText?.simpleText ?? v.shortViewCountText?.simpleText ?? "";
              const publishedText = v.publishedTimeText?.simpleText ?? null;
              const lengthText = v.lengthText?.simpleText ?? null;
              if (title) {
                out.push({
                  id: v.videoId,
                  title: title.slice(0, 260),
                  channel,
                  views: parseViewNum(viewsText),
                  viewsText: viewsText || null,
                  publishedText,
                  lengthText,
                  url: `https://www.youtube.com/watch?v=${v.videoId}`,
                });
              }
            }
            return;
          }
          if (Array.isArray(o)) {
            for (const x of o) walk(x);
          } else {
            for (const k of Object.keys(o)) walk(o[k]);
          }
        };
        walk(data);
      } catch {}
    }),
  );
  return out.sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 14);
}

async function fetchGNewsRss(query, hl = "pt-BR", gl = "BR", ceid = "BR:pt-419") {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const out = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const rawTitle = decodeHtml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const link = decodeHtml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const source = decodeHtml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
      const pubDate = decodeHtml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
      if (!rawTitle || !link) continue;
      const title = source ? rawTitle.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim() : rawTitle;
      const d = pubDate ? new Date(pubDate) : null;
      out.push({
        title: title.slice(0, 300),
        source: source || null,
        url: link,
        publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
      });
    }
    return out;
  } catch {
    return [];
  }
}

async function searchNews(q) {
  const [br, en] = await Promise.all([
    fetchGNewsRss(q, "pt-BR", "BR", "BR:pt-419"),
    fetchGNewsRss(q, "en-US", "US", "US:en"),
  ]);
  const seen = new Set();
  const out = [];
  for (const it of [...br, ...en]) {
    if (/^(X|Twitter|Reddit)$/i.test(it.source ?? "")) continue;
    const key = it.title.toLowerCase().slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
    if (out.length >= 16) break;
  }
  return out;
}

async function searchX(q) {
  const cleanHandle = q.trim().replace(/^@/, "");
  const isHandleLike = /^[A-Za-z0-9_]{2,25}$/.test(cleanHandle);
  const handleGuess = q.trim().startsWith("@")
    ? cleanHandle
    : isHandleLike
      ? cleanHandle
      : q.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

  const [fxPosts, brX, enX] = await Promise.all([
    (async () => {
      if (!handleGuess || handleGuess.length < 3 || handleGuess.length > 25) return [];
      try {
        const res = await fetch(`https://api.fxtwitter.com/2/profile/${handleGuess}/statuses`, {
          headers: { "User-Agent": ATLAS_UA },
          signal: AbortSignal.timeout(6000),
        });
        if (!res.ok) return [];
        const j = await res.json();
        return (j.results ?? []).slice(0, 10).map((p) => ({
          title: (p.text ?? "").replace(/\s+/g, " ").slice(0, 320),
          author: p.author?.screen_name ? `@${p.author.screen_name}` : `@${handleGuess}`,
          url: `https://x.com/${p.author?.screen_name ?? handleGuess}/status/${p.id}`,
          engagement: (p.likes ?? 0) + 2 * (p.reposts ?? 0) + (p.replies ?? 0) + (p.quotes ?? 0),
          publishedAt: p.created_timestamp ? new Date(p.created_timestamp * 1000).toISOString() : null,
        }));
      } catch {
        return [];
      }
    })(),
    fetchGNewsRss(`site:x.com "${q}"`, "pt-BR", "BR", "BR:pt-419"),
    fetchGNewsRss(`site:x.com "${q}"`, "en-US", "US", "US:en"),
  ]);

  const seen = new Set();
  const out = [];
  for (const p of fxPosts) {
    if (!p.title || seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  for (const it of [...brX, ...enX]) {
    const key = it.title.toLowerCase().slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: it.title,
      author: it.source || "X",
      url: it.url,
      engagement: null,
      publishedAt: it.publishedAt,
    });
    if (out.length >= 16) break;
  }
  return out;
}

async function searchReddit(q) {
  const subs = ["brasil", "brasilivre", "politics", "worldnews", "argentina", "portugal"];
  const [arcticLists, brR, enR] = await Promise.all([
    Promise.all(
      subs.map(async (sub) => {
        try {
          const url = `https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=${sub}&title=${encodeURIComponent(q)}&limit=8&sort=desc`;
          const res = await fetch(url, { headers: { "User-Agent": ATLAS_UA }, signal: AbortSignal.timeout(6000) });
          if (!res.ok) return [];
          const j = await res.json();
          return (j.data ?? [])
            .filter((p) => p.title && p.permalink && !p.removed_by_category)
            .map((p) => ({
              title: p.title.slice(0, 280),
              subreddit: `r/${sub}`,
              score: p.score ?? null,
              comments: p.num_comments ?? null,
              url: `https://www.reddit.com${p.permalink}`,
              publishedAt: p.created_utc ? new Date(p.created_utc * 1000).toISOString() : null,
            }));
        } catch {
          return [];
        }
      }),
    ),
    fetchGNewsRss(`site:reddit.com "${q}"`, "pt-BR", "BR", "BR:pt-419"),
    fetchGNewsRss(`site:reddit.com "${q}"`, "en-US", "US", "US:en"),
  ]);

  const seen = new Set();
  const out = [];
  for (const p of arcticLists.flat().sort((a, b) => (b.score ?? 0) - (a.score ?? 0))) {
    if (seen.has(p.url)) continue;
    seen.add(p.url);
    out.push(p);
  }
  for (const it of [...brR, ...enR]) {
    const key = it.title.toLowerCase().slice(0, 70);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: it.title,
      subreddit: "Reddit",
      score: null,
      comments: null,
      url: it.url,
      publishedAt: it.publishedAt,
    });
    if (out.length >= 14) break;
  }
  return out.slice(0, 14);
}

async function searchWiki(q) {
  const fetchLang = async (lang) => {
    try {
      const sr = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=2&format=json`,
        { headers: { "User-Agent": ATLAS_UA }, signal: AbortSignal.timeout(6000) },
      );
      if (!sr.ok) return [];
      const sj = await sr.json();
      const titles = (sj.query?.search ?? []).map((x) => x.title);
      if (!titles.length) return [];
      const er = await fetch(
        `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&titles=${encodeURIComponent(titles.join("|"))}&format=json`,
        { headers: { "User-Agent": ATLAS_UA }, signal: AbortSignal.timeout(6000) },
      );
      if (!er.ok) return [];
      const ej = await er.json();
      return Object.values(ej.query?.pages ?? {})
        .filter((p) => p.title && p.extract && p.extract.trim().length > 40)
        .map((p) => ({
          lang,
          title: p.title,
          extract: p.extract.trim().slice(0, 1400),
          url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
        }));
    } catch {
      return [];
    }
  };
  const [pt, en] = await Promise.all([fetchLang("pt"), fetchLang("en")]);
  return [...pt, ...(pt.length < 2 ? en : en.slice(0, 1))].slice(0, 3);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=900, stale-while-revalidate=3600");

  const q = String(req.query?.q ?? "").trim().slice(0, 120);
  if (q.length < 2) {
    res.status(400).json({ error: "Informe um termo com ao menos 2 caracteres." });
    return;
  }

  const [youtube, x, reddit, news, wiki] = await Promise.all([
    searchYouTube(q),
    searchX(q),
    searchReddit(q),
    searchNews(q),
    searchWiki(q),
  ]);

  res.status(200).json({
    query: q,
    fetchedAt: new Date().toISOString(),
    youtube,
    x,
    reddit,
    news,
    wiki,
  });
}
