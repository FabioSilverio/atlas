"use client";

import type { RecentSignalRow } from "@/app/data/recent.json/route";
import { fold, type Hit } from "./search-client";

export type EvidenceSignal = {
  platform: string;
  countryCode: string;
  title: string;
  author: string | null;
  url: string;
  publishedAt: string;
  metric: number | null;
  econ: number | null;
};

export type WikiSnippet = {
  lang: "pt" | "en";
  title: string;
  extract: string;
  url: string;
};

export type DossierEvidence = {
  query: string;
  wiki: WikiSnippet[];
  atlasHits: Hit[];
  signals: EvidenceSignal[];
  totalSignalsMatched: number;
};

export type LocalEngineMode = "webgpu" | "ollama";

export const WEBGPU_MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 1.5B (rápido · ~1 GB)" },
  { id: "Qwen2.5-3B-Instruct-q4f16_1-MLC", label: "Qwen 2.5 3B (mais detalhado · ~1,9 GB)" },
] as const;

let recentCache: Promise<EvidenceSignal[]> | null = null;

function loadRecentSignals(): Promise<EvidenceSignal[]> {
  recentCache ??= fetch("/data/recent.json")
    .then((r) => (r.ok ? r.json() : { rows: [] }))
    .then((j: { rows?: RecentSignalRow[] }) =>
      (j.rows ?? []).map(([platform, countryCode, title, author, url, publishedAt, metric, econ]) => ({
        platform,
        countryCode,
        title,
        author,
        url,
        publishedAt,
        metric,
        econ,
      })),
    )
    .catch(() => {
      recentCache = null;
      return [];
    });
  return recentCache;
}

async function fetchWiki(lang: "pt" | "en", query: string): Promise<WikiSnippet[]> {
  try {
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=2&format=json&origin=*`;
    const sr = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
    if (!sr.ok) return [];
    const sj = (await sr.json()) as { query?: { search?: { title: string }[] } };
    const titles = (sj.query?.search ?? []).map((x) => x.title);
    if (!titles.length) return [];

    const extUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts|info&exintro=1&explaintext=1&inprop=url&titles=${encodeURIComponent(titles.join("|"))}&format=json&origin=*`;
    const er = await fetch(extUrl, { signal: AbortSignal.timeout(8000) });
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

/** Gathers real cited evidence from ATLAS's live signal index + Wikipedia (PT & EN). */
export async function gatherDossierEvidence(query: string, atlasHits: Hit[]): Promise<DossierEvidence> {
  const words = fold(query)
    .split(" ")
    .filter((w) => w.length >= 2)
    .slice(0, 6);

  const [allSignals, ptWiki, enWiki] = await Promise.all([
    loadRecentSignals(),
    fetchWiki("pt", query),
    fetchWiki("en", query),
  ]);

  const matched = words.length
    ? allSignals.filter((s) => {
        const hay = fold(`${s.title} ${s.author ?? ""}`);
        return words.every((w) => hay.includes(w));
      })
    : [];

  // Keep a balanced, high-signal selection across platforms.
  const pick = (platform: string, max: number) =>
    matched
      .filter((s) => s.platform === platform)
      .sort((a, b) => (b.metric ?? 0) - (a.metric ?? 0) || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, max);

  const signals = [
    ...pick("news", 8),
    ...pick("x-voice", 10),
    ...pick("youtube", 8),
    ...pick("reddit", 6),
    ...pick("x", 5),
  ];

  // Prefer PT Wikipedia; include EN if PT returned fewer than 2 entries.
  const wiki = [...ptWiki, ...(ptWiki.length < 2 ? enWiki : enWiki.slice(0, 1))].slice(0, 3);

  return {
    query,
    wiki,
    atlasHits: atlasHits.slice(0, 16),
    signals,
    totalSignalsMatched: matched.length,
  };
}

const PLATFORM_LABEL: Record<string, string> = {
  news: "Notícia",
  "x-voice": "X (voz monitorada)",
  youtube: "YouTube",
  reddit: "Reddit",
  x: "Tendência X",
};

export function buildDossierMessages(ev: DossierEvidence): { role: "system" | "user"; content: string }[] {
  const lines: string[] = [];

  if (ev.wiki.length) {
    lines.push("## CONTEXTO ENCICLOPÉDICO (WIKIPÉDIA)");
    for (const w of ev.wiki) {
      lines.push(`### ${w.title} (${w.lang.toUpperCase()}) — ${w.url}\n${w.extract}`);
    }
  }

  if (ev.atlasHits.length) {
    lines.push("## REGISTROS NO BANCO DO ATLAS");
    for (const h of ev.atlasHits.slice(0, 12)) {
      lines.push(`- [${h.kind}] ${h.title}${h.subtitle ? ` — ${h.subtitle}` : ""}${h.countryCode ? ` (${h.countryCode})` : ""}`);
    }
  }

  if (ev.signals.length) {
    lines.push(`## MONITORAMENTO AO VIVO DO ATLAS (${ev.totalSignalsMatched} menções recentes; amostra principal abaixo)`);
    for (const s of ev.signals.slice(0, 22)) {
      const m = s.metric != null ? ` · métrica: ${s.metric}` : "";
      lines.push(`- [${PLATFORM_LABEL[s.platform] ?? s.platform} · ${s.countryCode}${m}] ${s.author ? `${s.author}: ` : ""}${s.title}`);
    }
  }

  const contextBlock = lines.length
    ? lines.join("\n")
    : "Nenhuma menção recente encontrada no índice do ATLAS ou na Wikipédia para este termo. Se tiver conhecimento geral seguro, contextualize brevemente deixando claro que não houve coleta recente no ATLAS.";

  return [
    {
      role: "system",
      content:
        "Você é um analista editorial do painel ATLAS (jornalismo de dados e inteligência política). " +
        "Escreva um dossiê objetivo, claro e bem estruturado em português do Brasil usando EXCLUSIVAMENTE as fontes fornecidas abaixo. " +
        "Regras rígidas: (1) nunca invente fatos, números ou citações que não estejam nas fontes; " +
        "(2) não rotule a ideologia de ninguém por conta própria — só mencione posições registradas nas fontes; " +
        "(3) quando não houver dados sobre algum ponto, diga explicitamente que não consta nas fontes coletadas; " +
        "(4) use títulos Markdown (##) curtos e listas diretas, fáceis de escanear.",
    },
    {
      role: "user",
      content:
        `Monte um dossiê sobre: "${ev.query}"\n\n` +
        "Estruture nestas seções:\n" +
        "## Resumo executivo\n" +
        "## Contexto e histórico\n" +
        "## O que está sendo debatido agora\n" +
        "## Pontos de tensão e argumentos em disputa\n" +
        "## Pontos a acompanhar\n\n" +
        "FONTES COLETADAS:\n" +
        contextBlock,
    },
  ];
}

// Reuse the loaded WebLLM engine across queries in the same browser session.
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
    throw new Error("Seu navegador não expõe WebGPU. Use Chrome/Edge atualizado ou mude para Ollama local.");
  }
  const webllm = await import("@mlc-ai/web-llm");
  if (!cachedEngine || cachedModelId !== opts.modelId) {
    opts.onProgress(0.01, "Preparando modelo local no navegador (fica em cache após o 1º uso)…");
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
      max_tokens: 1400,
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
