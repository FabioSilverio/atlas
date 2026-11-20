"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Hit } from "@/lib/search-client";
import {
  gatherDossierEvidence,
  hasWebGPU,
  streamOllamaDossier,
  streamWebGPUDossier,
  WEBGPU_MODELS,
  type DossierEvidence,
  type LocalEngineMode,
} from "@/lib/dossier-ai";

const PLATFORM_TAG: Record<string, string> = {
  news: "Notícia",
  "x-voice": "X",
  youtube: "YouTube",
  reddit: "Reddit",
  x: "Trend X",
};

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/**
 * On-demand dossier builder powered by local AI (WebGPU Qwen 2.5 in the browser
 * or a local Ollama server), grounded in ATLAS's live signals + Wikipedia.
 */
export function AiDossierPanel({ query, hits, autoStart = false }: { query: string; hits: Hit[]; autoStart?: boolean }) {
  const [mode, setMode] = useState<LocalEngineMode>("webgpu");
  const [webModel, setWebModel] = useState<string>(WEBGPU_MODELS[0].id);
  const [ollamaUrl, setOllamaUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("qwen2.5:3b");

  const [evidence, setEvidence] = useState<DossierEvidence | null>(null);
  const [status, setStatus] = useState<"idle" | "loading_model" | "generating" | "done" | "error">("idle");
  const [progress, setProgress] = useState<{ pct: number; text: string } | null>(null);
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const autoRanRef = useRef(false);

  const generate = useCallback(
    async (evOverride?: DossierEvidence) => {
      const ev = evOverride ?? evidence;
      if (!ev) return;
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
    },
    [evidence, mode, webModel, ollamaUrl, ollamaModel],
  );

  const generateRef = useRef(generate);
  useEffect(() => {
    generateRef.current = generate;
  }, [generate]);

  // Gather live evidence asynchronously (component remounts via key={query}).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let alive = true;
    gatherDossierEvidence(q, hits).then((ev) => {
      if (!alive) return;
      setEvidence(ev);
      if (autoStart && !autoRanRef.current && hasWebGPU()) {
        autoRanRef.current = true;
        void generateRef.current(ev);
      }
    });
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [query, hits, autoStart]);

  if (query.trim().length < 2) return null;

  const loadingEv = evidence === null;

  const busy = status === "loading_model" || status === "generating";

  const copyMd = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(`# Dossiê ATLAS: ${query}\n\n${output}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  return (
    <section className="mt-6 border border-line-strong bg-panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
        <div>
          <div className="label flex items-center gap-1.5 text-cyan">
            <span className="inline-block size-2 rounded-full bg-cyan" /> Dossiê sob demanda · IA local
          </div>
          <h2 className="mt-1 text-[20px] font-medium text-ink">“{query}”</h2>
          <p className="mt-1 text-[13px] text-muted">
            {loadingEv
              ? "Coletando evidências (ATLAS, X, YouTube, Reddit, manchetes e Wikipédia)…"
              : evidence
                ? `${evidence.wiki.length} verbete(s) da Wikipédia · ${evidence.atlasHits.length} registro(s) no ATLAS · ${evidence.totalSignalsMatched} menção(ões) recentes em X, YouTube, Reddit e notícias.`
                : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
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
              {output ? "↻ gerar novamente" : "✦ gerar dossiê com IA local"}
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
        </div>
      </div>

      {/* Engine configuration row */}
      <div className="mt-3 flex flex-wrap items-center gap-3 font-mono text-[11.5px] text-muted">
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
            <span>Roda 100% no seu navegador (GPU local, grátis, sem enviar dados a servidor).</span>
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
            <span>No PC: inicie o Ollama com OLLAMA_ORIGINS=*</span>
          </>
        )}
      </div>

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

      {/* Error box */}
      {error && (
        <div className="mt-4 border border-amber-dim bg-panel-2 px-3.5 py-2.5 text-[13px] text-amber">
          {error}
        </div>
      )}

      {/* Generated dossier output */}
      {output && (
        <div className="mt-5 border border-line bg-panel-2 p-5">
          <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
            <span className="label text-cyan">
              {status === "generating" ? "escrevendo dossiê…" : "dossiê gerado por IA local"}
            </span>
            <button type="button" onClick={copyMd} className="font-mono text-[11.5px] text-ink-2 hover:text-cyan">
              {copied ? "✓ copiado" : "copiar markdown"}
            </button>
          </div>
          <DossierMarkdown text={output} />
          <p className="mt-4 border-t border-line pt-2.5 font-mono text-[11px] text-muted">
            Síntese gerada localmente ({mode === "webgpu" ? webModel : `Ollama ${ollamaModel}`}) a partir das fontes listadas abaixo. Confira os links originais antes de citar.
          </p>
        </div>
      )}

      {/* Live collected evidence (always visible, even before running AI) */}
      {evidence && (evidence.wiki.length > 0 || evidence.signals.length > 0) && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {evidence.wiki.length > 0 && (
            <div>
              <div className="label mb-2">Contexto enciclopédico (Wikipédia ao vivo)</div>
              <ul className="space-y-2.5">
                {evidence.wiki.map((w) => (
                  <li key={w.url} className="border border-line bg-panel-2 p-3">
                    <a href={w.url} target="_blank" rel="noreferrer" className="text-[14.5px] font-medium text-ink hover:text-cyan">
                      {w.title} <span className="font-mono text-[11px] text-muted">({w.lang.toUpperCase()}) ↗</span>
                    </a>
                    <p className="mt-1 line-clamp-4 text-[13.5px] leading-relaxed text-ink-2">{w.extract}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {evidence.signals.length > 0 && (
            <div>
              <div className="label mb-2">
                Menções recentes no monitor ({evidence.totalSignalsMatched} encontradas)
              </div>
              <ul className="space-y-1.5">
                {evidence.signals.slice(0, 12).map((s) => (
                  <li key={s.platform + s.url} className="border border-line bg-panel-2 px-3 py-2">
                    <div className="flex items-center gap-2 font-mono text-[11px] text-muted">
                      <span className="border border-line-strong px-1.5 py-0.5 text-ink-2">{PLATFORM_TAG[s.platform] ?? s.platform}</span>
                      <span>{s.countryCode}</span>
                      {s.author && <span className="truncate">{s.author}</span>}
                      {s.metric != null && <span className="ml-auto shrink-0">{compact.format(s.metric)}</span>}
                    </div>
                    <a href={s.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-2 block text-[13.5px] leading-snug text-ink hover:text-cyan">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Lightweight safe Markdown renderer for headings, bullets, bold and paragraphs. */
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
