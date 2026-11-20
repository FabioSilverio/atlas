"use client";

import type { RecentSignalRow } from "@/app/data/recent.json/route";
import { fold, type Hit } from "./search-client";

export type LiveYouTube = {
  id: string;
  title: string;
  channel: string | null;
  views: number | null;
  viewsText: string | null;
  publishedText: string | null;
  lengthText: string | null;
  url: string;
};

export type LiveXPost = {
  title: string;
  author: string | null;
  url: string;
  engagement: number | null;
  publishedAt: string | null;
};

export type LiveRedditPost = {
  title: string;
  subreddit: string;
  score: number | null;
  comments: number | null;
  url: string;
  publishedAt: string | null;
};

export type LiveNewsItem = {
  title: string;
  source: string | null;
  url: string;
  publishedAt: string | null;
};

export type WikiSnippet = {
  lang: "pt" | "en";
  title: string;
  extract: string;
  url: string;
};

export type DossierEvidence = {
  query: string;
  fetchedAt: string;
  liveOk: boolean;
  wiki: WikiSnippet[];
  atlasHits: Hit[];
  youtube: LiveYouTube[];
  x: LiveXPost[];
  reddit: LiveRedditPost[];
  news: LiveNewsItem[];
};

export type LocalEngineMode = "webgpu" | "ollama";

export const WEBGPU_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 1.5B (rápido · ~1 GB)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 3B (mais detalhado · ~1,9 GB)" },
] as const;

type RecentSignal = {
  platform: string;
  countryCode: string;
  title: string;
  author: string | null;
  url: string;
  publishedAt: string;
  metric: number | null;
};

let recentCache: Promise<RecentSignal[]> | null = null;

function loadRecentSignals(): Promise<RecentSignal[]> {
  recentCache ??= fetch("/data/recent.json")
    .then((r) => (r.ok ? r.json() : { rows: [] }))
    .then((j: { rows?: RecentSignalRow[] }) =>
      (j.rows ?? []).map(([platform, countryCode, title, author, url, publishedAt, metric]) => ({
        platform,
        countryCode,
        title,
        author,
        url,
        publishedAt,
        metric,
      })),
    )
    .catch(() => {
      recentCache = null;
      return [];
    });
  return recentCache;
}

type LiveApiResponse = {
  fetchedAt?: string;
  youtube?: LiveYouTube[];
  x?: LiveXPost[];
  reddit?: LiveRedditPost[];
  news?: LiveNewsItem[];
  wiki?: WikiSnippet[];
};

async function fetchLiveWeb(query: string): Promise<LiveApiResponse | null> {
  try {
    const r = await fetch(`/api/research?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return null;
    return (await r.json()) as LiveApiResponse;
  } catch {
    return null;
  }
}

async function fetchWikiDirect(lang: "pt" | "en", query: string): Promise<WikiSnippet[]> {
  try {
    const sr = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!sr.ok) return [];
    const sj = (await sr.json()) as { query?: { search?: { title: string }[] } };
    const titles = (sj.query?.search ?? []).map((x) => x.title);
    if (!titles.length) return [];
    const er = await fetch(
      `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`,
      { signal: AbortSignal.timeout(6000) },
    );
    if (!er.ok) return [];
    const ej = (await er.json()) as { query?: { pages?: Record<string, { title?: string; extract?: string; fullurl?: string }> } };
    return Object.values(ej.query?.pages ?? {})
      .filter((p) => p.title && p.extract && p.extract.trim().length > 40)
      .map((p) => ({
        lang,
        title: p.title!,
        extract: p.extract!.trim().slice(0, 1400),
        url: p.fullurl ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title!)}`,
      }));
  } catch {
    return [];
  }
}

function ytId(url: string): string | null {
  return url.match(/[?&]v=([\w-]{11})/)?.[1] ?? url.match(/youtu\.be\/([\w-]{11})/)?.[1] ?? null;
}

/**
 * Gathers live evidence from the internet (/api/research scraping YouTube, X, Reddit, News, Wikipedia)
 * combined with ATLAS's own monitored signals (/data/recent.json) and database index.
 */
export async function gatherDossierEvidence(query: string, atlasHits: Hit[]): Promise<DossierEvidence> {
  const words = fold(query)
    .split(" ")
    .filter((w) => w.length >= 2)
    .slice(0, 6);

  const [live, allRecent] = await Promise.all([fetchLiveWeb(query), loadRecentSignals()]);

  const matchedRecent = words.length
    ? allRecent.filter((s) => {
        const hay = fold(`${s.title} ${s.author ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
    : [];

  // Merge ATLAS monitored signals with live internet scrape (deduped by URL).
  const ytSeen = new Set<string>();
  const youtube: LiveYouTube[] = [];
  for (const v of live?.youtube ?? []) {
    if (ytSeen.has(v.id)) continue;
    ytSeen.add(v.id);
    youtube.push(v);
  }
  for (const s of matchedRecent.filter((x) => x.platform === "youtube")) {
    const id = ytId(s.url);
    if (!id || ytSeen.has(id)) continue;
    ytSeen.add(id);
    youtube.push({ id, title: s.title, channel: s.author, views: s.metric, viewsText: null, publishedText: null, lengthText: null, url: s.url });
  }
  youtube.sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  const xSeen = new Set<string>();
  const x: LiveXPost[] = [];
  for (const s of matchedRecent.filter((r) => r.platform === "x-voice" || r.platform === "x").sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0))) {
    if (xSeen.has(s.url)) continue;
    xSeen.add(s.url);
    x.push({ title: s.title, author: s.author, url: s.url, engagement: s.metric, publishedAt: s.publishedAt });
  }
  for (const p of live?.x ?? []) {
    const k = p.title.toLowerCase().slice(0, 65);
    if (xSeen.has(p.url) || xSeen.has(k)) continue;
    xSeen.add(p.url);
    xSeen.add(k);
    x.push(p);
  }

  const rSeen = new Set<string>();
  const reddit: LiveRedditPost[] = [];
  for (const s of matchedRecent.filter((r) => r.platform === "reddit").sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0))) {
    if (rSeen.has(s.url)) continue;
    rSeen.add(s.url);
    reddit.push({ title: s.title, subreddit: s.author ?? "Reddit", score: s.metric, comments: null, url: s.url, publishedAt: s.publishedAt });
  }
  for (const p of live?.reddit ?? []) {
    const k = p.title.toLowerCase().slice(0, 65);
    if (rSeen.has(p.url) || rSeen.has(k)) continue;
    rSeen.add(p.url);
    rSeen.add(k);
    reddit.push(p);
  }

  const nSeen = new Set<string>();
  const news: LiveNewsItem[] = [];
  for (const it of live?.news ?? []) {
    const k = it.title.toLowerCase().slice(0, 65);
    if (nSeen.has(k)) continue;
    nSeen.add(k);
    news.push(it);
  }
  for (const s of matchedRecent.filter((r) => r.platform === "news")) {
    const k = s.title.toLowerCase().slice(0, 65);
    if (nSeen.has(k)) continue;
    nSeen.add(k);
    news.push({ title: s.title, source: s.author, url: s.url, publishedAt: s.publishedAt });
  }

  let wiki = live?.wiki ?? [];
  if (!wiki.length && !live) {
    const [pt, en] = await Promise.all([fetchWikiDirect("pt", query), fetchWikiDirect("en", query)]);
    wiki = [...pt, ...(pt.length < 2 ? en : en.slice(0, 1))].slice(0, 3);
  }

  return {
    query,
    fetchedAt: live?.fetchedAt ?? new Date().toISOString(),
    liveOk: Boolean(live),
    wiki,
    atlasHits: atlasHits.slice(0, 16),
    youtube: youtube.slice(0, 16),
    x: x.slice(0, 16),
    reddit: reddit.slice(0, 14),
    news: news.slice(0, 16),
  };
}

export function buildDossierMessages(ev: DossierEvidence): { role: "system" | "user"; content: string }[] {
  const lines: string[] = [];

  if (ev.wiki.length) {
    lines.push("## WIKIPÉDIA");
    for (const w of ev.wiki) lines.push(`### ${w.title} (${w.lang.toUpperCase()})\n${w.extract}`);
  }
  if (ev.atlasHits.length) {
    lines.push("## BANCO DO ATLAS");
    for (const h of ev.atlasHits.slice(0, 10)) {
      lines.push(`- [${h.kind}] ${h.title}${h.subtitle ? ` — ${h.subtitle}` : ""}`);
    }
  }
  if (ev.news.length) {
    lines.push("## NOTÍCIAS RECENTES");
    for (const n of ev.news.slice(0, 12)) lines.push(`- [${n.source ?? "Imprensa"}] ${n.title}`);
  }
  if (ev.youtube.length) {
    lines.push("## VÍDEOS MAIS VISTOS / RELEVANTES NO YOUTUBE");
    for (const v of ev.youtube.slice(0, 10)) {
      const vw = v.viewsText ?? (v.views != null ? `${v.views.toLocaleString("pt-BR")} views` : "");
      lines.push(`- [${v.channel ?? "YouTube"}${vw ? ` · ${vw}` : ""}] ${v.title}`);
    }
  }
  if (ev.x.length) {
    lines.push("## POSTS RELEVANTES NO X");
    for (const p of ev.x.slice(0, 10)) lines.push(`- [${p.author ?? "X"}] ${p.title}`);
  }
  if (ev.reddit.length) {
    lines.push("## DISCUSSÕES NO REDDIT");
    for (const r of ev.reddit.slice(0, 8)) lines.push(`- [${r.subreddit}${r.score != null ? ` · ▲${r.score}` : ""}] ${r.title}`);
  }

  const contextBlock = lines.length
    ? lines.join("\n")
    : "Nenhuma fonte retornada na coleta ao vivo para este termo.";

  return [
    {
      role: "system",
      content:
        "Você é um analista editorial do painel ATLAS (jornalismo de dados e inteligência política). " +
        "Escreva um dossiê objetivo, claro e bem estruturado em português do Brasil usando EXCLUSIVAMENTE as fontes coletadas da internet (YouTube, X, Reddit, notícias, Wikipédia e banco ATLAS) listadas abaixo. " +
        "Regras rígidas: (1) nunca invente fatos, números ou citações ausentes das fontes; " +
        "(2) não atribua rótulo ideológico por conta própria — apenas descreva o que as fontes mostram; " +
        "(3) cite os episódios, canais, veículos e polêmicas concretos que aparecem nas manchetes, vídeos e posts; " +
        "(4) use títulos Markdown (##) curtos e listas diretas.",
    },
    {
      role: "user",
      content:
        `Monte um dossiê completo sobre: "${ev.query}"\n\n` +
        "Estruture nestas seções:\n" +
        "## Resumo executivo\n" +
        "## Quem é / contexto\n" +
        "## O que está repercutindo no YouTube, X, Reddit e imprensa\n" +
        "## Principais debates, polêmicas e argumentos\n" +
        "## Pontos a acompanhar\n\n" +
        "FONTES COLETADAS AO VIVO:\n" +
        contextBlock,
    },
  ];
}

type WebLLMEngine = {
  chat: {
    completions: {
      create: (opts: {
        messages: { role: string; content: string }[];
        temperature?: number;
        max_tokens?: number;
        stream: true;
      }) => Promise<AsyncIterable<{ choices: { delta?: { content?: string | null } }[] }>>;
    };
  };
  interruptGenerate: () => void;
};

let cachedModelId: string | null = null;
let cachedEngine: WebLLMEngine | null = null;

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function streamWebGPUDossier(opts: {
  modelId: string;
  evidence: DossierEvidence;
  onProgress: (pct: number, text: string) => void;
  onToken: (chunk: string) => void;
  signal: AbortSignal;
}) {
  if (!hasWebGPU()) {
    throw new Error("Este dispositivo/navegador não suporta WebGPU para rodar o modelo local. As fontes ao vivo do YouTube, X, Reddit e notícias já estão listadas abaixo — ou use no Chrome/Edge no computador ou via Ollama local.");
  }
  const webllm = await import("@mlc-ai/web-llm");
  if (!cachedEngine || cachedModelId !== opts.modelId) {
    opts.onProgress(0.01, "Preparando Qwen 2.5 local no navegador (fica em cache após o 1º uso)…");
    const eng = (await webllm.CreateMLCEngine(opts.modelId, {
      initProgressCallback: (p) => opts.onProgress(p.progress ?? 0, p.text ?? "Carregando modelo…"),
    })) as unknown as WebLLMEngine;
    cachedEngine = eng;
    cachedModelId = opts.modelId;
  }

  const onAbort = () => cachedEngine?.interruptGenerate();
  opts.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const stream = await cachedEngine.chat.completions.create({
      messages: buildDossierMessages(opts.evidence),
      temperature: 0.25,
      max_tokens: 1500,
      stream: true,
    });
    for await (const part of stream) {
      if (opts.signal.aborted) break;
      const text = part.choices?.[0]?.delta?.content;
      if (text) opts.onToken(text);
    }
  } finally {
    opts.signal.removeEventListener("abort", onAbort);
  }
}

export async function streamOllamaDossier(opts: {
  baseUrl: string;
  model: string;
  evidence: DossierEvidence;
  onToken: (chunk: string) => void;
  signal: AbortSignal;
}) {
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/chat`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      messages: buildDossierMessages(opts.evidence),
      stream: true,
      options: { temperature: 0.25 },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Ollama respondeu HTTP ${res.status}. Confira se o modelo "${opts.model}" está baixado e se OLLAMA_ORIGINS=* está ativo.`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line) as { message?: { content?: string } };
        if (j.message?.content) opts.onToken(j.message.content);
      } catch {}
    }
  }
}
