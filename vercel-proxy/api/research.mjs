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

const FX = "https://api.fxtwitter.com/2";
const REDDIT = "https://arctic-shift.photon-reddit.com/api";
const DAY_MS = 86_400_000;

async function fetchJson(url, timeout = 6000) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": ATLAS_UA },
      signal: AbortSignal.timeout(timeout),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function postDate(seconds) {
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function xPost(p) {
  const author = p?.author?.screen_name;
  if (!p?.text || !author || !/^\d+$/.test(p.id)) return null;
  return {
    title: p.text.replace(/\s+/g, " ").slice(0, 320),
    body: p.text.slice(0, 3500),
    author: `@${author}`,
    url: `https://x.com/${author}/status/${p.id}`,
    engagement: (p.likes ?? 0) + 2 * (p.reposts ?? 0) + (p.replies ?? 0) + (p.quotes ?? 0),
    publishedAt: postDate(p.created_timestamp),
  };
}

async function searchX(q) {
  const handle = /^@[a-z0-9_]{2,25}$/i.test(q) ? q.slice(1) : null;
  const search = handle ? `from:${handle} OR @${handle}` : `"${q.replaceAll('"', " ")}"`;
  const directId = q.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:[a-z0-9_]+|i\/web)\/status\/(\d{2,20})(?:[/?#]|$)/i)?.[1];
  const direct = directId ? await fetchJson(`${FX}/conversation/${directId}`) : null;
  const data = directId ? { results: [direct?.status] } : await fetchJson(`${FX}/search?${new URLSearchParams({ q: search, feed: "latest", count: "16" })}`);
  const seen = new Set();
  const matches = (data?.results ?? []).filter((p) => {
    if (!xPost(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 10);

  return Promise.all(matches.map(async (p) => {
    const post = xPost(p);
    const conversation = direct ?? await fetchJson(`${FX}/conversation/${p.id}`, 5000);
    const main = conversation?.status ?? p;
    const used = new Set([p.id]);
    const context = [
      ...(conversation?.thread ?? []).map((entry) => ["Na conversa", entry]),
      ["Post citado", main.quote],
      ...(conversation?.replies ?? []).map((entry) => ["Resposta", entry]),
    ].flatMap(([label, entry]) => {
      const item = xPost(entry);
      if (!item || used.has(entry.id)) return [];
      used.add(entry.id);
      return [{ label, text: item.body, author: item.author, url: item.url }];
    });
    return {
      ...post,
      body: xPost(main)?.body ?? post.body,
      context: context.slice(0, 24),
      contextPartial: !conversation?.status || Boolean(conversation.cursor?.bottom) || context.length > 24,
    };
  }));
}

async function searchReddit(q) {
  const subs = ["brasil", "brasilivre", "politics", "worldnews", "argentina", "portugal"];
  const cutoff = Date.now() - 90 * DAY_MS;
  const after = new Date(cutoff).toISOString().slice(0, 10);
  const lists = await Promise.all(subs.map(async (subreddit) => {
    const params = new URLSearchParams({ subreddit, title: q, after, limit: "8", sort: "desc" });
    const result = await fetchJson(`${REDDIT}/posts/search?${params}`);
    return result?.data ?? [];
  }));

  const posts = lists.flat().filter((p) =>
    p.title && p.permalink?.startsWith("/") && /^[a-z0-9]+$/.test(p.id) &&
    !p.removed_by_category && p.created_utc * 1000 >= cutoff,
  ).sort((a, b) => b.created_utc - a.created_utc).slice(0, 10);

  return Promise.all(posts.map(async (p) => {
    const url = `https://www.reddit.com${p.permalink}`;
    const params = new URLSearchParams({ link_id: `t3_${p.id}`, limit: "50", sort: "asc" });
    const result = await fetchJson(`${REDDIT}/comments/search?${params}`, 5000);
    const comments = result?.data ?? [];
    return {
      title: p.title.slice(0, 280),
      subreddit: `r/${p.subreddit}`,
      score: p.score ?? null,
      comments: p.num_comments ?? null,
      url,
      publishedAt: postDate(p.created_utc),
      body: (p.selftext ?? "").slice(0, 3500),
      context: comments.filter((c) => c.body && !/^\[(removed|deleted)\]$/i.test(c.body))
        .slice(0, 24).map((c) => ({
          label: c.parent_id?.startsWith("t1_") ? `Resposta ao coment?rio ${c.parent_id.slice(3)}` : "Coment?rio",
          text: c.body.slice(0, 3500),
          author: c.author ?? null,
          url: `${url.replace(/\/$/, "")}/${c.id}/`,
        })),
      contextPartial: !result || comments.length >= 24 || (p.num_comments ?? 0) > comments.length,
    };
  }));
}

async function searchBackground(q) {
  const subject = q.replaceAll('"', " ");
  const sources = await Promise.all([
    fetchGNewsRss(`"${subject}" ("pai" OR "fam?lia" OR "irm?os")`),
    fetchGNewsRss(`"${subject}" ("igreja" OR "religi?o")`),
  ]);
  const editorial = /^felipe (?:campos )?sestaro$/i.test(subject) ? [{
    title: "Quem ? Felipe Sestaro",
    source: "Gazeta do Povo",
    url: "https://www.gazetadopovo.com.br/vida-e-cidadania/apresentador-felipe-sestaro-ganha-projecao-com-embates-politicos-no-irontalks/",
    publishedAt: null,
    extract: "A reportagem relata que Felipe Sestaro atuou como mission?rio evang?lico da igreja Bola de Neve durante o per?odo em que viveu na R?ssia.",
  }] : [];
  return [...editorial, ...new Map(sources.flat().map((item) => [item.title, item])).values()].slice(0, 10);
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

  const [youtube, x, reddit, news, wiki, background] = await Promise.all([
    searchYouTube(q),
    searchX(q),
    searchReddit(q),
    searchNews(q),
    searchWiki(q),
    searchBackground(q),
  ]);

  res.status(200).json({
    query: q,
    fetchedAt: new Date().toISOString(),
    youtube,
    x,
    reddit,
    news,
    wiki,
    background,
  });
}
