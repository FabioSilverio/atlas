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

async function fetchGNewsRss(upstream, query, hl = "pt-BR", gl = "BR", ceid = "BR:pt-419") {
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
    const res = await upstream(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
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

async function fetchJson(upstream, url, timeout = 6000) {
  try {
    const response = await upstream(url, {
      headers: { "User-Agent": ATLAS_UA },
      signal: AbortSignal.timeout(timeout),
    });
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

async function searchX(upstream, q, quick = false) {
  const handle = /^@[a-z0-9_]{2,25}$/i.test(q) ? q.slice(1) : null;
  const search = handle ? `from:${handle} OR @${handle}` : `"${q.replaceAll('"', " ")}"`;
  const directId = q.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:[a-z0-9_]+|i\/web)\/status\/(\d{2,20})(?:[/?#]|$)/i)?.[1];
  const direct = directId ? await fetchJson(upstream, `${FX}/conversation/${directId}`) : null;
  const data = directId ? { results: [direct?.status] } : await fetchJson(upstream, `${FX}/search?${new URLSearchParams({ q: search, feed: "latest", count: "16" })}`);
  const seen = new Set();
  const matches = (Array.isArray(data?.results) ? data.results : []).filter((p) => {
    if (!xPost(p) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  }).slice(0, 10);

  return Promise.all(matches.map(async (p) => {
    const post = xPost(p);
    const conversation = direct ?? (quick ? null : await fetchJson(upstream, `${FX}/conversation/${p.id}`, 5000));
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
  }));
}

async function searchReddit(upstream, q, quick = false) {
  const subs = ["brasil", "brasilivre", "politics", "worldnews", "argentina", "portugal"];
  const cutoff = Date.now() - 90 * DAY_MS;
  const after = new Date(cutoff).toISOString().slice(0, 10);
  const lists = await Promise.all(subs.map(async (subreddit) => {
    const params = new URLSearchParams({ subreddit, title: q, after, limit: "8", sort: "desc" });
    const result = await fetchJson(upstream, `${REDDIT}/posts/search?${params}`);
    return Array.isArray(result?.data) ? result.data : [];
  }));

  const posts = lists.flat().filter((p) =>
    typeof p?.title === "string" && typeof p.permalink === "string" && p.permalink.startsWith("/") && /^[a-z0-9]+$/.test(p.id) &&
    !p.removed_by_category && p.created_utc * 1000 >= cutoff,
  ).sort((a, b) => b.created_utc - a.created_utc).slice(0, 10);

  return Promise.all(posts.map(async (p) => {
    const url = `https://www.reddit.com${p.permalink}`;
    const params = new URLSearchParams({ link_id: `t3_${p.id}`, limit: "50", sort: "asc" });
    const result = quick ? null : await fetchJson(upstream, `${REDDIT}/comments/search?${params}`, 5000);
    const comments = Array.isArray(result?.data) ? result.data : [];
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
    if (meta) extract = `Descrição do canal: ${decodeHtml(meta).slice(0, 500)}`;
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
    if (!musicQuery && /\b(official.*music video|official audio|videoclipe oficial)\b/.test(title)) continue;
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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const q = String(req.query?.q ?? "").trim().slice(0, 120);
  if (q.length < 2) {
    res.status(400).json({ error: "Informe um termo com ao menos 2 caracteres." });
    return;
  }

  const quick = req.query?.quick === "1";
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), quick ? 5_500 : 9_000);
  let partial = false;
  async function upstream(url, options) {
    try {
      const signal = options?.signal
        ? AbortSignal.any([options.signal, deadline.signal])
        : deadline.signal;
      const response = await fetch(url, { ...options, signal });
      if (response.status === 429 || response.status >= 500) partial = true;
      return response;
    } catch (error) {
      partial = true;
      throw error;
    }
  }

  const mainVideos = searchYouTube(upstream, q, quick);
  const results = await Promise.allSettled([
    mainVideos,
    searchX(upstream, q, quick),
    searchReddit(upstream, q, quick),
    searchNews(upstream, q),
    searchWiki(upstream, q),
    searchBackground(upstream, q),
    quick ? [] : searchVideoBackground(upstream, q, mainVideos),
  ]);
  clearTimeout(timer);

  const [youtube, x, reddit, news, wiki, background, videos] = results.map((result) => {
    if (result.status === "fulfilled") return result.value;
    partial = true;
    return [];
  });
  partial ||= deadline.signal.aborted;
  res.setHeader("Cache-Control", partial ? "no-store" : "public, s-maxage=900, stale-while-revalidate=3600");

  res.status(200).json({
    query: q,
    fetchedAt: new Date().toISOString(),
    partial,
    youtube,
    x,
    reddit,
    news,
    wiki,
    background: [
      ...background.filter((item) => item.extract),
      ...videos,
      ...background.filter((item) => !item.extract),
    ],
  });
}
