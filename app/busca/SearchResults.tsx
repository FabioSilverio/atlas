"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { AiDossierPanel } from "@/components/search/AiDossierPanel";
import { KIND_LABEL } from "@/lib/ui/labels";
import { searchLocal, type Hit } from "@/lib/search-client";

const EMPTY_HITS: Hit[] = [];
const EXAMPLES = ["Lula", "Flávio Bolsonaro", "Javier Milei", "STF", "Donald Trump", "Peter Thiel", "populismo"];

const TOUCH_POINTER = "(pointer: coarse)";

function subscribeToPointer(onChange: () => void) {
  const pointer = window.matchMedia(TOUCH_POINTER);
  pointer.addEventListener("change", onChange);
  return () => pointer.removeEventListener("change", onChange);
}

function readTouchPointer() {
  return window.matchMedia(TOUCH_POINTER).matches;
}

function readServerPointer() {
  return null;
}

/** Global search over the static index + on-demand local AI dossier, in the browser. */
export function SearchResults() {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const compactSearch = useSyncExternalStore(subscribeToPointer, readTouchPointer, readServerPointer);
  const [searchArchive, setSearchArchive] = useState(false);
  const [result, setResult] = useState<{ q: string; hits: Hit[] } | null>(null);
  useEffect(() => {
    if (compactSearch === null || (compactSearch && !searchArchive)) return;
    let alive = true;
    if (q.trim().length >= 2) searchLocal(q, 80).then((hits) => alive && setResult({ q, hits }));
    return () => {
      alive = false;
    };
  }, [q, compactSearch, searchArchive]);
  const hits = q.trim().length < 2 || (compactSearch && !searchArchive) ? [] : result?.q === q ? result.hits : null;
  const groups = new Map<string, Hit[]>();
  for (const h of hits ?? []) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);

  return (
    <>
      <div className="label">Busca global</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
          // Close the phone keyboard so the results are visible right away.
          (e.currentTarget.elements.namedItem("q") as HTMLInputElement | null)?.blur();
          router.replace(v ? `/busca?q=${encodeURIComponent(v)}` : "/busca");
        }}
        className="mt-2 flex gap-2"
      >
        <input
          key={q}
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          defaultValue={q}
          placeholder="Digite uma pessoa, termo, partido ou assunto para pesquisar e gerar dossiê…"
          className="h-11 min-w-0 flex-1 border border-line-strong bg-bg px-3.5 font-mono text-base text-ink placeholder:text-muted focus:border-cyan-dim focus:outline-none"
        />
        <button className="h-11 border border-cyan-dim px-5 font-mono text-[12.5px] text-cyan hover:bg-panel-3">buscar</button>
      </form>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
        <span>Sugestões:</span>
        {EXAMPLES.map((ex) => (
          <Link key={ex} href={`/busca?q=${encodeURIComponent(ex)}`} className="border border-line bg-panel-2 px-2 py-0.5 text-ink-2 hover:border-cyan-dim hover:text-cyan">
            {ex}
          </Link>
        ))}
      </p>

      {q.trim().length >= 2 && compactSearch !== null && <AiDossierPanel key={`${q.trim()}:${compactSearch}`} query={q.trim()} hits={hits ?? EMPTY_HITS} quick={compactSearch === true} />}

      {q.trim().length >= 2 && compactSearch && !searchArchive && (
        <button type="button" onClick={() => setSearchArchive(true)} className="mt-4 min-h-11 border border-line px-3 text-sm text-cyan">Buscar também no acervo</button>
      )}
      {q && hits === null && <p className="mt-8 font-mono text-[12px] text-muted">buscando no índice do ATLAS…</p>}
      {q && (compactSearch === false || searchArchive) && hits?.length === 0 && <p className="mt-8 text-[14px] text-muted">Nenhum registro fixo no índice do ATLAS para “{q}” — você ainda pode gerar o dossiê com IA acima usando Wikipédia e o monitor ao vivo.</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {[...groups].map(([kind, list]) => (
          <section key={kind}>
            <h2 className="label mb-2 border-b border-line pb-1">
              {KIND_LABEL[kind] ?? kind} <span className="text-muted">({list.length})</span>
            </h2>
            <ul className="space-y-px">
              {list.map((h) => (
                <li key={h.kind + h.ref}>
                  <Link href={h.url} className="block bg-panel-2 px-3 py-2 hover:bg-panel-3" target={h.url.startsWith("http") ? "_blank" : undefined}>
                    <span className="block truncate text-[14px] text-ink">{h.title}</span>
                    {h.subtitle && <span className="block truncate text-[12px] text-muted">{h.subtitle}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
