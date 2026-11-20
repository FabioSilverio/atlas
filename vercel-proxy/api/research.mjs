// On-demand live web scraper for ATLAS /busca?q=... (YouTube, X, Reddit, Instagram, TikTok, Facebook,
// Threads, Bluesky, Google News, Wikipedia, Câmara and Senado). Runs only when a user submits a search.
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

async function searchYouTube(upstream, q, contextSearch = false) {
  // Fetch both most-viewed (CAMSAhAB) and most-relevant searches in parallel.
  const urls = [
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=CAMSAhAB`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  ];
  if (contextSearch) urls.shift();
  const seen = new Set();
  const out = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await upstream(url, {
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
              const description = v.detailedMetadataSnippets?.[0]?.snippetText?.runs
                ?.map((run) => run.text).join("").trim() ?? null;
              if (title) {
                out.push({
                  id: v.videoId,
                  title: title.slice(0, 260),
                  channel,
                  views: parseViewNum(viewsText),
                  viewsText: viewsText || null,
                  publishedText,
                  lengthText,
                  description: description?.slice(0, 500) ?? null,
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
  return (contextSearch ? out : out.sort((a, b) => (b.views ?? 0) - (a.views ?? 0))).slice(0, 14);
}

async function fetchGNewsRss(upstream, query, hl = "pt-BR", gl = "BR", ceid = "BR:pt-419", { withSourceUrl = false } = {}) {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res = await upstream(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const out = [];
    for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const block = m[1];
      const rawTitle = decodeHtml(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
      const link = decodeHtml(block.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "");
      const source = decodeHtml(block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "");
      const sourceUrl = block.match(/<source url="([^"]*)"/)?.[1] ?? null;
      const pubDate = decodeHtml(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
      if (!rawTitle || !link) continue;
      const title = source ? rawTitle.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim() : rawTitle;
      const d = pubDate ? new Date(pubDate) : null;
      out.push({
        title: title.slice(0, 300),
        source: source || null,
        url: link,
        publishedAt: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        ...(withSourceUrl ? { sourceUrl } : {}),
      });
    }
    return out;
  } catch {
    return [];
  }
}

// Google News wraps every link in an opaque article id. Resolve it to the real URL
// (two small requests) so X posts can be hydrated with author, metrics and replies.
async function decodeGoogleNewsUrl(upstream, link) {
  const id = link.match(/news\.google\.com\/(?:rss\/)?articles\/([\w-]+)/)?.[1];
  if (!id) return null;
  try {
    const page = await upstream(`https://news.google.com/rss/articles/${id}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(3500),
    });
    if (!page.ok) return null;
    const html = await page.text();
    const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
    const timestamp = Number(html.match(/data-n-a-ts="([^"]+)"/)?.[1]);
    if (!signature || !Number.isFinite(timestamp)) return null;
    const inner = JSON.stringify([
      "garturlreq",
      [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
      id, timestamp, signature,
    ]);
    const response = await upstream("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", inner, null, "generic"]]]) }),
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return null;
    const text = await response.text();
    const url = text.match(/\\"garturlres\\",\\"(https?:[^"\\]+)\\"/)?.[1];
    return url && /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

async function searchNews(upstream, q) {
  const [br, en] = await Promise.all([
    fetchGNewsRss(upstream, q, "pt-BR", "BR", "BR:pt-419"),
    fetchGNewsRss(upstream, q, "en-US", "US", "US:en"),
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

async function fetchJson(upstream, url, timeout = 6000, retries = 0) {
  try {
    const response = await upstream(url, {
      headers: { "User-Agent": ATLAS_UA },
      signal: AbortSignal.timeout(timeout),
    });
    if ((response.status === 429 || response.status === 422) && retries > 0) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return fetchJson(upstream, url, timeout, retries - 1);
    }
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function postDate(seconds) {
  const date = new Date(seconds * 1000);
  return Number.isFinite(seconds) && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function xPost(p) {
  const author = p?.author?.screen_name;
  if (typeof p?.text !== "string" || !p.text || !author || !/^\d+$/.test(p.id)) return null;
  return {
    title: p.text.replace(/\s+/g, " ").slice(0, 320),
    body: p.text.slice(0, 3500),
    author: `@${author}`,
    url: `https://x.com/${author}/status/${p.id}`,
    engagement: (p.likes ?? 0) + 2 * (p.reposts ?? 0) + (p.replies ?? 0) + (p.quotes ?? 0),
    publishedAt: postDate(p.created_timestamp),
  };
}

const X_STATUS = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([a-z0-9_]{1,25}|i\/web)\/status\/(\d{2,20})(?:[/?#]|$)/i;

// fxtwitter's search endpoint was retired, so X posts are discovered through Google News
// (which indexes x.com) and then hydrated one by one through fxtwitter's status API.
async function discoverXPosts(upstream, q, quick) {
  const handle = /^@[a-z0-9_]{2,25}$/i.test(q) ? q.slice(1) : null;
  const subject = handle ? `site:x.com/${handle}` : `"${q.replaceAll('"', " ")}" site:x.com`;
  const [recent, relevant, fx] = await Promise.all([
    fetchGNewsRss(upstream, `${subject} when:30d`, "pt-BR", "BR", "BR:pt-419", { withSourceUrl: true }),
    quick ? [] : fetchGNewsRss(upstream, subject, "pt-BR", "BR", "BR:pt-419", { withSourceUrl: true }),
    // Kept as a bonus in case fxtwitter brings search back; it no longer blocks the request.
    fetchJson(upstream, `${FX}/search?${new URLSearchParams({ q: handle ? `from:${handle}` : `"${q}"`, feed: "latest", count: "16" })}`, 2500),
  ]);
  const seen = new Set();
  const found = [];
  for (const p of Array.isArray(fx?.results) ? fx.results : []) {
    if (xPost(p) && !seen.has(p.id)) {
      seen.add(p.id);
      found.push({ raw: p });
    }
  }
  const items = [...recent, ...relevant].filter((item) => /(^|\/\/)(www\.)?(x|twitter)\.com/.test(item.sourceUrl ?? ""));
  const unique = [...new Map(items.map((item) => [item.title.slice(0, 80), item])).values()].slice(0, quick ? 5 : 8);
  const decoded = await Promise.all(unique.map((item) => decodeGoogleNewsUrl(upstream, item.url)));
  unique.forEach((item, index) => {
    const match = decoded[index]?.match(X_STATUS);
    if (match && seen.has(match[2])) return;
    if (match) seen.add(match[2]);
    found.push({ item, id: match?.[2] ?? null, handle: match?.[1] && match[1] !== "i/web" ? match[1] : null });
  });
  return found;
}

async function searchX(upstream, q, quick = false) {
  const directId = q.match(X_STATUS)?.[2];
  if (directId) {
    const direct = await fetchJson(upstream, `${FX}/conversation/${directId}`);
    return direct?.status ? [hydrateX(direct.status, direct)] : [];
  }
  const found = (await discoverXPosts(upstream, q, quick)).slice(0, 10);
  const posts = await Promise.all(found.map(async (entry) => {
    if (entry.raw) {
      const conversation = quick ? null : await fetchJson(upstream, `${FX}/conversation/${entry.raw.id}`, 4000);
      return hydrateX(entry.raw, conversation);
    }
    if (entry.id) {
      const conversation = await fetchJson(upstream, `${FX}/${quick ? "status" : "conversation"}/${entry.id}`, quick ? 3000 : 4000);
      const status = conversation?.status ?? conversation?.tweet;
      if (xPost(status)) return hydrateX(status, quick ? null : conversation);
    }
    // Hydration failed: still show the post text Google indexed, linking to it.
    const text = entry.item.title.replace(/\s+-\s+X$/, "");
    return {
      title: text.slice(0, 320),
      body: text,
      author: entry.handle ? `@${entry.handle}` : null,
      url: entry.id && entry.handle ? `https://x.com/${entry.handle}/status/${entry.id}` : entry.item.url,
      engagement: null,
      publishedAt: entry.item.publishedAt,
      context: [],
      contextPartial: true,
    };
  }));
  return posts.filter(Boolean);
}

function hydrateX(p, conversation) {
  {
    const post = xPost(p);
    const main = conversation?.status ?? p;
    const used = new Set([p.id]);
    const context = [
      ...(Array.isArray(conversation?.thread) ? conversation.thread : []).map((entry) => ["Na conversa", entry]),
      ["Post citado", main.quote],
      ...(Array.isArray(conversation?.replies) ? conversation.replies : []).map((entry) => ["Resposta", entry]),
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
  }
}

const PULLPUSH = "https://api.pullpush.io/reddit/search";

async function searchReddit(upstream, q, quick = false, extraUpstream = upstream) {
  const cutoff = Date.now() - 90 * DAY_MS;
  const subject = q.replace(/^@/, "").replaceAll('"', " ").trim();
  // Arctic Shift times out on wide title scans, so keep its window short and the
  // subreddit list small; PullPush covers every other subreddit with full-text search.
  const recentAfter = new Date(Date.now() - 30 * DAY_MS).toISOString().slice(0, 10);
  const latestAfter = new Date(Date.now() - 7 * DAY_MS).toISOString().slice(0, 10);
  const scanSubs = quick
    ? ["brasil", "brasilivre", "BrasildoB"]
    : ["brasil", "brasilivre", "BrasildoB", "NoticiasBR", "politics", "worldnews"];
  const titleSubs = quick ? [] : ["brasil"];
  const [scan, arctic, pullpush] = await Promise.all([
    // Listing a subreddit's newest posts is cheap and reliable on Arctic Shift (its title
    // search often times out), so pull the latest week two subreddits at a time and match locally.
    (async () => {
      const lists = [];
      for (let i = 0; i < scanSubs.length; i += 2) {
        const batch = await Promise.all(scanSubs.slice(i, i + 2).map((subreddit) => {
          const params = new URLSearchParams({ subreddit, after: latestAfter, limit: "100", sort: "desc" });
          return fetchJson(upstream, `${REDDIT}/posts/search?${params}`, 4000, 1);
        }));
        for (const result of batch) if (Array.isArray(result?.data)) lists.push(result.data);
      }
      return lists;
    })(),
    // Title search reaches back 30 days when Arctic Shift has capacity; best effort only.
    (async () => {
      const lists = [];
      for (const subreddit of titleSubs) {
        const params = new URLSearchParams({ subreddit, title: subject, after: recentAfter, limit: "8", sort: "desc" });
        const result = await fetchJson(extraUpstream, `${REDDIT}/posts/search?${params}`, 3500);
        if (Array.isArray(result?.data)) lists.push(result.data);
      }
      return lists;
    })(),
    // PullPush blocks most cloud IPs but answers from some regions; best effort only.
    (async () => {
      const params = new URLSearchParams({
        q: subject.includes(" ") ? `"${subject}"` : subject,
        size: "25",
        sort: "desc",
        sort_type: "created_utc",
        after: String(Math.floor(cutoff / 1000)),
      });
      const result = await fetchJson(extraUpstream, `${PULLPUSH}/submission/?${params}`, 4000);
      return Array.isArray(result?.data) ? result.data : [];
    })(),
  ]);

  const words = normalizeSearchText(subject).match(/[a-z0-9]{3,}/g) ?? [];
  const seen = new Set();
  const posts = [...arctic.flat(), ...scan.flat(), ...pullpush].filter((p) => {
    if (typeof p?.title !== "string" || typeof p.permalink !== "string" || !p.permalink.startsWith("/r/") || !/^[a-z0-9]+$/.test(p.id)) return false;
    if (p.removed_by_category || p.over_18 || seen.has(p.id) || p.created_utc * 1000 < cutoff) return false;
    if (/^u_/.test(p.subreddit ?? "")) return false;
    const text = normalizeSearchText(`${p.title} ${p.selftext ?? ""}`);
    if (!words.every((word) => text.includes(word))) return false;
    seen.add(p.id);
    return true;
  }).sort((a, b) => (b.num_comments ?? 0) + (b.score ?? 0) / 4 - ((a.num_comments ?? 0) + (a.score ?? 0) / 4)).slice(0, 10);

  // Two comment lookups at a time for the six busiest threads keeps under the burst limits.
  const slots = [Promise.resolve(), Promise.resolve()];
  return Promise.all(posts.map(async (p, index) => {
    const url = `https://www.reddit.com${p.permalink}`;
    let comments = [];
    let result = null;
    if (!quick && index < 6 && (p.num_comments ?? 1) > 0) {
      const slot = index % slots.length;
      const previous = slots[slot];
      let release;
      slots[slot] = new Promise((resolve) => { release = resolve; });
      await previous;
      const params = new URLSearchParams({ link_id: `t3_${p.id}`, limit: "50", sort: "asc" });
      result = await fetchJson(upstream, `${REDDIT}/comments/search?${params}`, 3500);
      if (!Array.isArray(result?.data)) {
        result = await fetchJson(upstream, `${PULLPUSH}/comment/?${new URLSearchParams({ link_id: p.id, size: "50", sort: "asc" })}`, 3000);
      }
      release();
      comments = Array.isArray(result?.data) ? result.data : [];
    }
    return {
      title: p.title.slice(0, 280),
      subreddit: `r/${p.subreddit}`,
      score: p.score ?? null,
      comments: p.num_comments ?? null,
      url,
      publishedAt: postDate(p.created_utc),
      body: typeof p.selftext === "string" ? p.selftext.slice(0, 3500) : "",
      context: comments.filter((c) => typeof c?.body === "string" && c.body && !/^\[(removed|deleted)\]$/i.test(c.body))
        .slice(0, 24).map((c) => ({
          label: typeof c.parent_id === "string" && c.parent_id.startsWith("t1_") ? `Resposta ao comentário ${c.parent_id.slice(3)}` : "Comentário",
          text: c.body.slice(0, 3500),
          author: c.author ?? null,
          url: `${url.replace(/\/$/, "")}/${c.id}/`,
        })),
      contextPartial: !result || comments.length >= 24 || (p.num_comments ?? 0) > comments.length,
    };
  }));
}

function normalizeSearchText(value) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function readVideoEvidence(upstream, video, query) {
  const source = {
    title: video.title,
    source: video.channel || "YouTube",
    url: video.url,
    publishedAt: null,
  };
  let extract = video.description ? `Trecho da descrição indexada do canal: ${video.description}` : null;
  try {
    const response = await upstream(video.url, {
      headers: { "User-Agent": UA, "Accept-Language": "pt-BR" },
      signal: AbortSignal.timeout(3500),
    });
    if (!response.ok) return { ...source, extract };
    const html = await response.text();
    const meta = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
    // YouTube serves its own boilerplate when a video has no description; skip it.
    if (meta && !/^(Aproveite os vídeos e as músicas|Aproveite vídeos e músicas|Enjoy the videos and music)/i.test(decodeHtml(meta))) {
      extract = `Descrição do canal: ${decodeHtml(meta).slice(0, 500)}`;
    }
    const playerMatch = html.match(/(?:var )?ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
    if (!playerMatch) return { ...source, extract };
    const player = JSON.parse(playerMatch[1]);
    const description = player.videoDetails?.shortDescription?.trim();
    if (description) extract = `Descrição do canal: ${description.slice(0, 500)}`;
    source.publishedAt = player.microformat?.playerMicroformatRenderer?.publishDate ?? null;
    const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const track = tracks.find((item) => item.languageCode === "pt" && item.kind !== "asr")
      ?? tracks.find((item) => item.languageCode?.startsWith("pt"))
      ?? tracks[0];
    if (!track?.baseUrl) return { ...source, extract };
    const captionUrl = new URL(track.baseUrl);
    if (captionUrl.origin !== "https://www.youtube.com" || captionUrl.pathname !== "/api/timedtext") {
      return { ...source, extract };
    }
    captionUrl.searchParams.set("fmt", "json3");
    const captionsResponse = await upstream(captionUrl, {
      headers: { "User-Agent": UA },
      redirect: "error",
      signal: AbortSignal.timeout(3500),
    });
    if (!captionsResponse.ok) return { ...source, extract };
    const captions = await captionsResponse.json();
    const rows = (captions.events ?? []).flatMap((event) => {
      const text = event.segs?.map((segment) => segment.utf8).join("").trim();
      return text && Number.isFinite(event.tStartMs) ? [{ text, time: event.tStartMs }] : [];
    });
    const words = normalizeSearchText(query).match(/[a-z0-9]{3,}/g) ?? [];
    const windows = rows.flatMap((row, index) => {
      if (index % 5 !== 0) return [];
      const text = rows.slice(index, index + 8).map((item) => item.text).join(" ");
      const normalized = normalizeSearchText(text);
      const matched = words.filter((word) => normalized.includes(word)).length;
      const background = /\b(pai|irmaos?|familia|igreja|trajetoria|origem)\b/.test(normalized);
      return [{ text, time: row.time, score: matched * 2 + Number(background) }];
    });
    const best = windows.sort((a, b) => b.score - a.score)[0];
    if (!best?.score) return { ...source, extract };
    const time = Math.floor(best.time / 1000);
    return {
      ...source,
      url: `${source.url}&t=${time}s`,
      extract: `Trecho da legenda${track.kind === "asr" ? " automática" : ""}, em ${time}s: ${best.text.slice(0, 550)}`,
    };
  } catch {
    return { ...source, extract };
  }
}

async function searchVideoBackground(upstream, q, mainVideos) {
  const [documentary, interview, main] = await Promise.all([
    searchYouTube(upstream, `${q} dossiê documentário`, true),
    searchYouTube(upstream, `${q} entrevista história`, true),
    mainVideos,
  ]);
  const keywords = normalizeSearchText(q).match(/[a-z0-9]{3,}/g) ?? [];
  const musicQuery = /\b(music[ao]?|videoclipe|cantor|banda|album)\b/.test(normalizeSearchText(q));
  const selected = new Map();
  for (const video of [documentary[0], interview[0], ...main, ...documentary, ...interview]) {
    if (!video || !/^[\w-]{11}$/.test(video.id)) continue;
    const title = normalizeSearchText(video.title);
    if (!keywords.every((word) => title.includes(word))) continue;
    if (!musicQuery && /\b(official.*music video|official audio|official m\/?v|official video|lyric video|videoclipe oficial|clipe oficial)\b|\bm\/?v\b/.test(title)) continue;
    // Auto-generated music tracks ("Provided to YouTube by <label>").
    if (!musicQuery && /provided to youtube by|auto-generated by youtube/i.test(video.description ?? "")) continue;
    selected.set(video.id, video);
    if (selected.size >= 3) break;
  }
  const sources = await Promise.all([...selected.values()].map((video) => readVideoEvidence(upstream, video, q)));
  return sources.sort((a, b) => Number(Boolean(b.extract)) - Number(Boolean(a.extract)));
}

async function searchBackground(upstream, q) {
  const subject = q.replaceAll('"', " ");
  const sources = await Promise.all([
    fetchGNewsRss(upstream, `"${subject}" ("pai" OR "família" OR "irmãos")`),
    fetchGNewsRss(upstream, `"${subject}" ("igreja" OR "religião")`),
  ]);
  const editorial = /^felipe (?:campos )?sestaro$/i.test(subject) ? [{
    title: "Quem é Felipe Sestaro",
    source: "Gazeta do Povo",
    url: "https://www.gazetadopovo.com.br/vida-e-cidadania/apresentador-felipe-sestaro-ganha-projecao-com-embates-politicos-no-irontalks/",
    publishedAt: null,
    extract: "A reportagem relata que Felipe Sestaro atuou como missionário evangélico da igreja Bola de Neve durante o período em que viveu na Rússia.",
  }, {
    title: "Bossa Nova, restaurante brasileiro em Moscou",
    source: "Afisha Daily",
    url: "https://daily.afisha.ru/eating/2570-bossa-nova-sovremennaya-brazilskaya-kuhnya-na-yugo-zapadnoy/",
    publishedAt: "2016-08-09",
    extract: "Em agosto de 2016, a reportagem identificou Paolo Sestaro como pai de Felipe e pizzaiolo do restaurante Bossa Nova, em Moscou.",
  }, {
    title: "Fé modelo exportação",
    source: "Gazeta Russa / Russia Beyond",
    url: "https://br.rbth.com/sociedade/2014/11/20/fe_modelo_exportacao_28335",
    publishedAt: "2014-11-20",
    extract: "Em entrevista de 2014, Felipe Sestaro falou sobre seu trabalho missionário em Moscou. A reportagem o apresentou como pastor e idealizador da filial local da Bola de Neve.",
  }, {
    title: "Dossiê Sestaro, capítulo sobre o pai (4:20)",
    source: "Canal do VKS",
    url: "https://www.youtube.com/watch?v=Gw2yEHO4COY&t=260s",
    publishedAt: null,
    extract: "O vídeo discute a relação de Felipe com o pai e cita a Afisha Daily. A matéria documenta o trabalho no restaurante em 2016; a interpretação do canal sobre a duração do afastamento continua sendo uma alegação.",
  }] : [];
  return [...editorial, ...new Map(sources.flat().map((item) => [item.title, item])).values()].slice(0, 10);
}

async function searchWiki(upstream, q) {
  const fetchLang = async (lang) => {
    try {
      const sr = await upstream(
        `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=2&format=json`,
        { headers: { "User-Agent": ATLAS_UA }, signal: AbortSignal.timeout(6000) },
      );
      if (!sr.ok) return [];
      const sj = await sr.json();
      const titles = (sj.query?.search ?? []).map((x) => x.title);
      if (!titles.length) return [];
      const er = await upstream(
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

const SOCIAL_SITES = [
  ["Instagram", "instagram.com"],
  ["TikTok", "tiktok.com"],
  ["Facebook", "facebook.com"],
  ["Threads", "threads.net"],
];

async function searchBluesky(upstream, q) {
  const params = new URLSearchParams({ q: q.replace(/^@/, ""), limit: "12", sort: "top" });
  const data = await fetchJson(upstream, `https://api.bsky.app/xrpc/app.bsky.feed.searchPosts?${params}`, 5000);
  return (Array.isArray(data?.posts) ? data.posts : []).flatMap((p) => {
    const text = p?.record?.text;
    const handle = p?.author?.handle;
    const rkey = typeof p?.uri === "string" ? p.uri.split("/").pop() : null;
    if (typeof text !== "string" || !text.trim() || !handle || !rkey) return [];
    return [{
      platform: "Bluesky",
      title: text.replace(/\s+/g, " ").slice(0, 320),
      author: `@${handle}`,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      engagement: (p.likeCount ?? 0) + 2 * (p.repostCount ?? 0) + (p.replyCount ?? 0) + (p.quoteCount ?? 0),
      publishedAt: p.record.createdAt ?? null,
    }];
  });
}

// Posts from other networks that Google News indexes (captions, reels, videos).
async function searchSocial(upstream, q, quick) {
  const subject = `"${q.replace(/^@/, "").replaceAll('"', " ")}"`;
  const sites = quick ? SOCIAL_SITES.slice(0, 2) : SOCIAL_SITES;
  const [bluesky, ...lists] = await Promise.all([
    searchBluesky(upstream, q),
    ...sites.map(async ([platform, domain]) => {
      const items = await fetchGNewsRss(upstream, `${subject} site:${domain}`, "pt-BR", "BR", "BR:pt-419", { withSourceUrl: true });
      return items.filter((item) => (item.sourceUrl ?? "").includes(domain)).slice(0, 5).map((item) => ({
        platform,
        title: item.title.replace(new RegExp(`\\s+-\\s+${platform}$`, "i"), "").slice(0, 320),
        author: null,
        url: item.url,
        engagement: null,
        publishedAt: item.publishedAt,
      }));
    }),
  ]);
  // Interleave platforms so one network doesn't crowd out the others.
  const queues = [...lists, bluesky.slice(0, 6)];
  const mixed = [];
  for (let round = 0; round < 6; round++) for (const queue of queues) if (queue[round]) mixed.push(queue[round]);
  const seen = new Set();
  return mixed.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 80);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}

// Official records for sitting members of Congress (Câmara and Senado open data).
async function searchOfficial(upstream, q) {
  const subject = q.replace(/^@/, "").trim();
  if (subject.length < 4 || /^https?:/i.test(subject)) return [];
  const words = normalizeSearchText(subject).match(/[a-z0-9]{2,}/g) ?? [];
  const [camara, senado] = await Promise.all([
    fetchJson(upstream, `https://dadosabertos.camara.leg.br/api/v2/deputados?${new URLSearchParams({ nome: subject, ordem: "ASC", ordenarPor: "nome" })}`, 5000),
    fetchJson(upstream, "https://legis.senado.leg.br/dadosabertos/senador/lista/atual.json", 5000),
  ]);
  // One-word queries ("Lula") must equal the parliamentary name, not just appear in it.
  const named = (name) => {
    const folded = normalizeSearchText(name);
    return words.length > 1 ? words.every((word) => folded.includes(word)) : folded === normalizeSearchText(subject);
  };
  const deputies = (Array.isArray(camara?.dados) ? camara.dados : []).filter((d) => named(d.nome ?? "")).slice(0, 3).map((d) => ({
    title: `${d.nome} (${d.siglaPartido}-${d.siglaUf})`,
    source: "Câmara dos Deputados",
    url: `https://www.camara.leg.br/deputados/${d.id}`,
    publishedAt: null,
    extract: `Registro oficial: ${d.nome} é deputado(a) federal em exercício pelo ${d.siglaPartido}, eleito(a) por ${d.siglaUf}.`,
  }));
  const senators = (senado?.ListaParlamentarEmExercicio?.Parlamentares?.Parlamentar ?? []).flatMap((entry) => {
    const s = entry?.IdentificacaoParlamentar;
    if (!s?.NomeParlamentar) return [];
    if (!words.length || !(named(s.NomeParlamentar) || (words.length > 1 && named(s.NomeCompletoParlamentar ?? "")))) return [];
    return [{
      title: `${s.NomeParlamentar} (${s.SiglaPartidoParlamentar}-${s.UfParlamentar})`,
      source: "Senado Federal",
      url: String(s.UrlPaginaParlamentar ?? "").replace(/^http:/, "https:"),
      publishedAt: null,
      extract: `Registro oficial: ${s.NomeCompletoParlamentar ?? s.NomeParlamentar} é senador(a) em exercício pelo ${s.SiglaPartidoParlamentar}, representando ${s.UfParlamentar}.`,
    }];
  }).slice(0, 2);
  return [...deputies, ...senators];
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = String(req.query?.q ?? "").trim().slice(0, 120);
  if (q.length < 2) {
    res.status(400).json({ error: "Informe um termo com ao menos 2 caracteres." });
    return;
  }

  const quick = req.query?.quick === "1";
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), quick ? 6_500 : 11_000);
  // A source only counts as failed when it errored AND returned nothing, so one slow
  // optional endpoint (e.g. a retired API) no longer flags the whole search as broken.
  const errors = new Set();
  const diag = [];
  const tracked = (source) => async (url, options) => {
    const host = new URL(url).host;
    try {
      const signal = options?.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
      const response = await fetch(url, { ...options, signal });
      if (response.status === 429 || response.status >= 500) errors.add(source);
      if (!response.ok) diag.push(`${source} ${host} ${response.status}`);
      return response;
    } catch (error) {
      errors.add(source);
      diag.push(`${source} ${host} ${error?.name ?? "error"}`);
      throw error;
    }
  };

  const mainVideos = searchYouTube(tracked("youtube"), q, quick);
  const jobs = {
    youtube: mainVideos,
    x: searchX(tracked("x"), q, quick),
    reddit: searchReddit(tracked("reddit"), q, quick, tracked("reddit-extra")),
    news: searchNews(tracked("news"), q),
    wiki: searchWiki(tracked("wiki"), q),
    social: searchSocial(tracked("social"), q, quick),
    official: searchOfficial(tracked("official"), q),
    background: searchBackground(tracked("background"), q),
    videos: quick ? Promise.resolve([]) : searchVideoBackground(tracked("videos"), q, mainVideos),
  };
  const names = Object.keys(jobs);
  const settled = await Promise.allSettled(Object.values(jobs));
  clearTimeout(timer);

  const out = {};
  const failed = [];
  settled.forEach((result, index) => {
    const name = names[index];
    out[name] = result.status === "fulfilled" && Array.isArray(result.value) ? result.value : [];
    if (out[name].length === 0 && (result.status === "rejected" || errors.has(name))) failed.push(name);
  });
  const visible = failed.filter((name) => ["youtube", "x", "reddit", "news", "wiki", "social"].includes(name));
  const partial = visible.length > 0;
  res.setHeader("Cache-Control", partial ? "public, s-maxage=60" : "public, s-maxage=900, stale-while-revalidate=3600");

  res.status(200).json({
    query: q,
    fetchedAt: new Date().toISOString(),
    partial,
    failed: visible,
    ...(req.query?.debug === "1" ? { diag: diag.slice(0, 60) } : {}),
    youtube: out.youtube,
    x: out.x,
    reddit: out.reddit,
    news: out.news,
    wiki: out.wiki,
    social: out.social,
    background: [
      ...out.official,
      ...out.background.filter((item) => item.extract),
      ...out.videos,
      ...out.background.filter((item) => !item.extract),
    ],
  });
}
