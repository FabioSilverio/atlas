"use client";

import { useEffect, useRef, useState } from "react";
import type { Hit } from "@/lib/search-client";
import {
  gatherDossierEvidence,
  mergeDossierEvidence,
  streamOllamaDossier,
  streamWebGPUDossier,
  WEBGPU_MODELS,
  type DossierEvidence,
  type LocalEngineMode,
} from "@/lib/dossier-ai";

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

const SOURCE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  x: "X",
  reddit: "Reddit",
  news: "Google Notícias",
  wiki: "Wikipédia",
  social: "Instagram/TikTok",
};

function listJoin(items: string[]) {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} e ${items.at(-1)}` : items[0] ?? "";
}

/**
 * Live internet research + on-demand local AI dossier panel.
 * Scrapes YouTube, X, Reddit, Google News and Wikipedia for any query via /api/research,
 * merges with ATLAS's own data, and synthesizes a dossier using local AI (WebGPU Qwen 2.5 or Ollama).
 */
export function AiDossierPanel({ query, hits, quick = false }: { query: string; hits: Hit[]; quick?: boolean }) {
  const [mode, setMode] = useState<LocalEngineMode>("webgpu");
  const [webModel, setWebModel] = useState<string>(WEBGPU_MODELS[0].id);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen3.5:4b");

  const [evidence, setEvidence] = useState<DossierEvidence | null>(null);
  const [status, setStatus] = useState<"idle" | "loading_model" | "generating" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const [retry, setRetry] = useState(0);
  const [updating, setUpdating] = useState(false);
  const [researchError, setResearchError] = useState(false);

  async function generate() {
    if (quick || !evidence) return;
    const ev = { ...evidence, atlasHits: hits.slice(0, 16) };
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOutput("");
    setError(null);
    setStatus(mode === "webgpu" ? "loading_model" : "generating");
    setProgress(mode === "webgpu" ? { pct: 0, text: "Iniciando IA local…" } : null);
    try {
      if (mode === "webgpu") {
        await streamWebGPUDossier({
          modelId: webModel,
          evidence: ev,
          onProgress: (pct, text) => {
            setProgress({ pct, text });
            if (pct >= 0.99) setStatus("generating");
          },
          onToken: (chunk) => {
            setStatus("generating");
            setProgress(null);
            setOutput((prev) => prev + chunk);
          },
          signal: ctrl.signal,
        });
      } else {
        await streamOllamaDossier({
          baseUrl: ollamaUrl,
          model: ollamaModel,
          evidence: ev,
          onToken: (chunk) => setOutput((prev) => prev + chunk),
          signal: ctrl.signal,
        });
      }
      setStatus("done");
    } catch (err) {
      if (ctrl.signal.aborted) {
        setStatus("done");
        return;
      }
      setStatus("error");
      setError((err as Error).message || "Falha ao executar a IA local.");
    }
  }

  useEffect(() => {
    const request = new AbortController();
    // Phones get a fast first pass, then the full search (threads, replies, video captions)
    // continues on its own; if that second pass fails, the first results simply stay.
    const phases = quick ? [true, false] : [false];
    (async () => {
      let anyOk = false;
      for (const [index, phaseQuick] of phases.entries()) {
        if (index > 0) setUpdating(true);
        try {
          const ev = await gatherDossierEvidence(query, { quick: phaseQuick, includeRecent: !quick, signal: request.signal });
          if (request.signal.aborted) return;
          setEvidence((previous) => mergeDossierEvidence(previous, ev));
          if (ev.liveOk) {
            anyOk = true;
            setResearchError(false);
          }
        } catch {
          if (request.signal.aborted) return;
        }
      }
      setResearchError(!anyOk);
      setUpdating(false);
    })();
    return () => {
      request.abort();
      abortRef.current?.abort();
    };
  }, [query, quick, retry]);

  if (query.trim().length < 2) return null;

  const loadingEv = evidence === null && !researchError;
  const busy = status === "loading_model" || status === "generating";
  const totalLive = evidence ? evidence.youtube.length + evidence.x.length + evidence.reddit.length + evidence.news.length + evidence.wiki.length + evidence.social.length + evidence.background.length : 0;
  const failedNames = (evidence?.failed ?? []).map((name) => SOURCE_LABEL[name] ?? name);

  const copyMd = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(`# Dossiê ATLAS: ${query}\n\n${output}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <section className="mt-6 border border-line-strong bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <div className="label flex items-center gap-1.5 text-cyan">
            <span className={`inline-block size-2 rounded-full bg-cyan ${loadingEv || busy ? "live-dot" : ""}`} /> {quick && (loadingEv || updating) ? "Pesquisa rápida" : "Pesquisa ao vivo"}
          </div>
          <h2 className="mt-1 text-[22px] font-medium text-ink">“{query}”</h2>
          <p className="mt-1 text-[13px] text-muted">
            {loadingEv
              ? "Buscando ao vivo no YouTube, X, Reddit, Instagram, TikTok, Bluesky, notícias e Wikipédia…"
              : evidence
                ? `${evidence.youtube.length} vídeos · ${evidence.x.length} posts no X · ${evidence.reddit.length} tópicos no Reddit · ${evidence.social.length} em outras redes · ${evidence.news.length} notícias · ${evidence.wiki.length} Wikipédia`
                : null}
          </p>
        </div>

        {!quick && <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line-strong bg-bg font-mono text-[11.5px]">
            <button
              type="button"
              onClick={() => setMode("webgpu")}
              className={`px-2.5 py-1.5 transition-colors ${mode === "webgpu" ? "bg-panel-3 text-cyan" : "text-muted hover:text-ink"}`}
            >
              Navegador (WebGPU)
            </button>
            <button
              type="button"
              onClick={() => setMode("ollama")}
              className={`border-l border-line-strong px-2.5 py-1.5 transition-colors ${mode === "ollama" ? "bg-panel-3 text-cyan" : "text-muted hover:text-ink"}`}
            >
              Ollama local
            </button>
          </div>

          {!busy ? (
            <button
              type="button"
              disabled={loadingEv || !evidence}
              onClick={() => generate()}
              className="border border-cyan bg-cyan/10 px-4 py-1.5 font-mono text-[12px] text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-40"
            >
              {output ? "↻ gerar dossiê novamente" : "✦ gerar dossiê com IA local"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="border border-amber-dim bg-amber/10 px-4 py-1.5 font-mono text-[12px] text-amber hover:bg-amber/20"
            >
              ■ parar
            </button>
          )}
        </div>}
      </div>

      {/* Engine settings */}
      {!quick && <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-muted">
        {mode === "webgpu" ? (
          <>
            <label className="flex items-center gap-2">
              <span>modelo:</span>
              <select
                value={webModel}
                onChange={(e) => setWebModel(e.target.value)}
                disabled={busy}
                className="border border-line-strong bg-bg px-2 py-1 text-ink focus:border-cyan-dim focus:outline-none"
              >
                {WEBGPU_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <span>Roda grátis na GPU local (Chrome/Edge).</span>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              <span>URL:</span>
              <input
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                disabled={busy}
                className="w-44 border border-line-strong bg-bg px-2 py-1 text-ink focus:border-cyan-dim focus:outline-none"
              />
            </label>
            <label className="flex items-center gap-2">
              <span>modelo:</span>
              <input
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                disabled={busy}
                className="w-32 border border-line-strong bg-bg px-2 py-1 text-ink focus:border-cyan-dim focus:outline-none"
              />
            </label>
            <span>Inicie com OLLAMA_ORIGINS=*</span>
          </>
        )}
      </div>}

      {/* Model download / load progress */}
      {progress && status === "loading_model" && (
        <div className="mt-4 border border-line bg-panel-2 p-3">
          <div className="flex items-center justify-between font-mono text-[11.5px] text-ink-2">
            <span className="truncate">{progress.text}</span>
            <span className="ml-2 shrink-0 text-cyan tabular">{Math.round(progress.pct * 100)}%</span>
          </div>
          <div className="mt-2 h-1.5 w-full bg-panel-3">
            <div className="h-full bg-cyan transition-all duration-200" style={{ width: `${Math.max(2, Math.round(progress.pct * 100))}%` }} />
          </div>
        </div>
      )}

      {error && <div className="mt-4 border border-amber-dim bg-panel-2 px-3.5 py-2.5 text-[13px] text-amber">{error}</div>}

      {/* AI Generated Dossier */}
      {output && (
        <div className="mt-5 border border-cyan-dim/60 bg-panel-2 p-5">
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <span className="label text-cyan">{status === "generating" ? "escrevendo dossiê…" : "dossiê gerado por IA local"}</span>
            <button type="button" onClick={copyMd} className="font-mono text-[11.5px] text-ink-2 hover:text-cyan">
              {copied ? "✓ copiado" : "copiar markdown"}
            </button>
          </div>
          <DossierMarkdown text={output} />
          <p className="mt-4 border-t border-line pt-2.5 font-mono text-[11px] text-muted">
            Síntese gerada localmente ({mode === "webgpu" ? webModel : `Ollama ${ollamaModel}`}) a partir da coleta ao vivo abaixo. Confira os links antes de citar.
          </p>
        </div>
      )}

      {!updating && (researchError || evidence?.partial || (evidence && totalLive === 0)) && (
        <div className="mt-4 text-sm text-muted">
          <p role="status">
            {researchError
              ? totalLive > 0 ? "A atualização falhou. Os resultados anteriores continuam abaixo." : "A pesquisa ao vivo está indisponível agora."
              : evidence?.partial ? `${failedNames.length ? `${listJoin(failedNames)} não ${failedNames.length > 1 ? "responderam" : "respondeu"} agora.` : "Algumas fontes não responderam agora."} O restante da pesquisa está abaixo.`
              : "Nenhuma fonte encontrada para este termo."}
          </p>
          {(researchError || evidence?.partial) && <button type="button" className="min-h-11 text-cyan"
            onClick={() => { setResearchError(false); setUpdating(Boolean(evidence)); setRetry((n) => n + 1); }}>
            Tentar novamente
          </button>}
        </div>
      )}

      {updating && (
        <p role="status" className="mt-3 flex items-center gap-2 text-sm text-muted">
          <span className="live-dot inline-block size-2 rounded-full bg-cyan" /> Buscando conversas, respostas e mais fontes…
        </p>
      )}

      {evidence && evidence.background.length > 0 && (
        <div className="mt-5">
          <h3 className="label mb-2">Fontes de contexto</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {evidence.background.slice(0, 6).map((source) => (
              <li key={source.url} className="min-w-0 border border-line bg-panel-2 p-3 text-sm">
                <a href={source.url} target="_blank" rel="noreferrer" className="font-medium text-cyan">{source.title}</a>
                <div className="mt-1 text-xs text-muted">{source.source ?? "Web"}</div>
                {source.extract && <p className="mt-2 break-words text-ink-2">{source.extract}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Loading skeleton */}
      {loadingEv && (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="h-32 animate-pulse border border-line bg-panel-2" />
          <div className="h-32 animate-pulse border border-line bg-panel-2" />
        </div>
      )}

      {/* Live scraped evidence across all platforms */}
      {evidence && totalLive > 0 && (
        <div className="mt-6 space-y-6">
          {/* Wikipedia */}
          {evidence.wiki.length > 0 && (
            <div>
              <div className="label mb-2">Wikipédia</div>
              <div className="grid gap-2.5 md:grid-cols-2">
                {evidence.wiki.map((w) => (
                  <div key={w.url} className="border border-line bg-panel-2 p-3">
                    <a href={w.url} target="_blank" rel="noreferrer" className="text-[15px] font-medium text-ink hover:text-cyan">
                      {w.title} <span className="font-mono text-[11px] text-muted">({w.lang.toUpperCase()}) ↗</span>
                    </a>
                    <p className="mt-1 line-clamp-4 text-[13.5px] leading-relaxed text-ink-2">{w.extract}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* YouTube */}
          {evidence.youtube.length > 0 && (
            <div>
              <div className="label mb-2">YouTube — vídeos relevantes ({evidence.youtube.length})</div>
              <ul className="grid gap-3 md:grid-cols-2">
                {evidence.youtube.slice(0, 12).map((v) => (
                  <li key={v.id} className="border border-line bg-panel-2 p-2.5">
                    <a href={v.url} target="_blank" rel="noreferrer" className="group flex gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`}
                        alt=""
                        loading="lazy"
                        className="h-[68px] w-[120px] shrink-0 bg-panel-3 object-cover transition-opacity group-hover:opacity-80"
                      />
                      <span className="min-w-0">
                        <span className="line-clamp-2 text-[14px] leading-snug text-ink group-hover:text-cyan">{v.title}</span>
                        <span className="mt-1 block truncate font-mono text-[11.5px] text-muted">
                          {v.channel ?? "YouTube"}
                          {v.views != null ? ` · ${compact.format(v.views)} views` : v.viewsText ? ` · ${v.viewsText}` : ""}
                          {v.publishedText ? ` · ${v.publishedText}` : ""}
                        </span>
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* X + Reddit + News */}
          <div className="grid gap-6 lg:grid-cols-2">
            {evidence.x.length > 0 && (
              <div>
                <div className="label mb-2">X — posts relevantes ({evidence.x.length})</div>
                <ul className="space-y-2">
                  {evidence.x.slice(0, 10).map((p) => (
                    <li key={p.url + p.title.slice(0, 20)} className="border border-line bg-panel-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                        <span className="truncate text-ink-2">{p.author ?? "X"}</span>
                        {p.engagement != null && <span className="shrink-0">{compact.format(p.engagement)} int.</span>}
                      </div>
                      <a href={p.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-3 block text-[13.5px] leading-snug text-ink hover:text-cyan">
                        {p.title}
                      </a>
                      {Boolean(p.context?.length || (p.body && p.body !== p.title)) && (
                        <details className="mt-2 break-words text-xs text-muted">
                          <summary className="cursor-pointer py-2 text-cyan">Ver contexto</summary>
                          {p.body && <p className="mb-2 whitespace-pre-line">{p.body}</p>}
                          {p.context?.slice(0, 10).map((item) => (
                            <p className="mb-2" key={item.url}>
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan">{item.label}</a> {item.text}
                            </p>
                          ))}
                          {(p.contextPartial || (p.context?.length ?? 0) > 10) && <p>Contexto parcial.</p>}
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evidence.reddit.length > 0 && (
              <div>
                <div className="label mb-2">Reddit — discussões ({evidence.reddit.length})</div>
                <ul className="space-y-2">
                  {evidence.reddit.slice(0, 10).map((r) => (
                    <li key={r.url + r.title.slice(0, 20)} className="border border-line bg-panel-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                        <span className="truncate text-ink-2">{r.subreddit}</span>
                        {r.score != null && <span className="shrink-0">▲ {compact.format(r.score)}</span>}
                      </div>
                      <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-2 block text-[13.5px] leading-snug text-ink hover:text-cyan">
                        {r.title}
                      </a>
                      {Boolean(r.context?.length || (r.body && r.body !== r.title)) && (
                        <details className="mt-2 break-words text-xs text-muted">
                          <summary className="cursor-pointer py-2 text-cyan">Ver contexto</summary>
                          {r.body && <p className="mb-2 whitespace-pre-line">{r.body}</p>}
                          {r.context?.slice(0, 10).map((item) => (
                            <p className="mb-2" key={item.url}>
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-cyan">{item.label}</a> {item.text}
                            </p>
                          ))}
                          {(r.contextPartial || (r.context?.length ?? 0) > 10) && <p>Contexto parcial.</p>}
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evidence.social.length > 0 && (
              <div>
                <div className="label mb-2">Instagram, TikTok e outras redes ({evidence.social.length})</div>
                <ul className="space-y-2">
                  {evidence.social.slice(0, 12).map((s) => (
                    <li key={s.url + s.title.slice(0, 20)} className="border border-line bg-panel-2 px-3 py-2">
                      <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
                        <span className="truncate text-ink-2">{s.platform}{s.author ? ` · ${s.author}` : ""}</span>
                        {s.engagement != null && s.engagement > 0 && <span className="shrink-0">{compact.format(s.engagement)} int.</span>}
                      </div>
                      <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-3 block text-[13.5px] leading-snug text-ink hover:text-cyan">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {evidence.news.length > 0 && (
              <div>
                <div className="label mb-2">Notícias e web ({evidence.news.length})</div>
                <ul className="space-y-2">
                  {evidence.news.slice(0, 10).map((n) => (
                    <li key={n.url + n.title.slice(0, 20)} className="border border-line bg-panel-2 px-3 py-2">
                      <a href={n.url} target="_blank" rel="noreferrer" className="line-clamp-2 block text-[13.5px] leading-snug text-ink hover:text-cyan">
                        {n.title}
                      </a>
                      <div className="mt-1 font-mono text-[11px] text-muted">{n.source ?? "Web"}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function DossierMarkdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-3 text-[14.5px] leading-relaxed text-ink-2">
      {blocks.map((block, idx) => {
        const lines = block.split("\n").filter((l) => l.trim().length > 0);
        if (!lines.length) return null;
        if (lines.length === 1 && /^#{1,3}\s+/.test(lines[0])) {
          return (
            <h3 key={idx} className="pt-2 font-mono text-[12.5px] uppercase tracking-[0.14em] text-ink">
              {lines[0].replace(/^#{1,3}\s+/, "")}
            </h3>
          );
        }
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={idx} className="ml-5 list-disc space-y-1.5">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-*•]\s+/, "")} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <div key={idx} className="space-y-1.5">
            {lines.map((l, j) =>
              /^#{1,3}\s+/.test(l) ? (
                <h3 key={j} className="pt-2 font-mono text-[12.5px] uppercase tracking-[0.14em] text-ink">
                  {l.replace(/^#{1,3}\s+/, "")}
                </h3>
              ) : /^\s*[-*•]\s+/.test(l) ? (
                <p key={j} className="pl-3 before:mr-2 before:text-cyan before:content-['•']">
                  <Inline text={l.replace(/^\s*[-*•]\s+/, "")} />
                </p>
              ) : (
                <p key={j}>
                  <Inline text={l} />
                </p>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i} className="font-medium text-ink">
            {p.slice(2, -2)}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
