"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { KIND_LABEL } from "@/lib/ui/labels";
import { searchLocal, type Hit } from "@/lib/search-client";

/** Global search over the static index, in the browser. */
export function SearchResults() {
  const router = useRouter();
  const q = useSearchParams().get("q") ?? "";
  const [result, setResult] = useState<{ q: string; hits: Hit[] } | null>(null);
  useEffect(() => {
    let alive = true;
    if (q.trim().length >= 2) searchLocal(q, 80).then((hits) => alive && setResult({ q, hits }));
    return () => {
      alive = false;
    };
  }, [q]);
  const hits = q.trim().length < 2 ? [] : result?.q === q ? result.hits : null;
  const groups = new Map<string, Hit[]>();
  for (const h of hits ?? []) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);

  return (
    <>
      <div className="label">Busca global</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
          router.replace(v ? `/busca?q=${encodeURIComponent(v)}` : "/busca");
        }}
        className="mt-2 flex gap-2"
      >
        <input
          key={q}
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="País, pessoa, pensador, partido, ideologia, tema…"
          className="h-10 min-w-0 flex-1 border border-line-strong bg-bg px-3 font-mono text-[14px] text-ink placeholder:text-muted focus:border-cyan-dim focus:outline-none"
        />
        <button className="h-10 border border-cyan-dim px-4 font-mono text-[12px] text-cyan hover:bg-panel-3">buscar</button>
      </form>
      <p className="mt-2 text-[12px] text-muted">
        Busca textual sem acentos em todos os dados do ATLAS. Ex.: <Link href="/busca?q=populismo" className="text-ink-2 underline">populismo</Link>,{" "}
        <Link href="/busca?q=economista brasil" className="text-ink-2 underline">economista brasil</Link>, <Link href="/busca?q=bolsonaro" className="text-ink-2 underline">bolsonaro</Link>.
      </p>
      {q && hits === null && <p className="mt-8 font-mono text-[12px] text-muted">buscando…</p>}
      {q && hits?.length === 0 && <p className="mt-8 text-[14px] text-muted">Nada encontrado para “{q}”.</p>}
      <div className="mt-6 grid gap-8 md:grid-cols-2">
        {[...groups].map(([kind, list]) => (
          <section key={kind}>
            <h2 className="label mb-2 border-b border-line pb-1">
              {KIND_LABEL[kind] ?? kind} <span className="text-muted">({list.length})</span>
            </h2>
            <ul className="space-y-px">
              {list.map((h) => (
                <li key={h.kind + h.ref}>
                  <Link href={h.url} className="block bg-panel-2 px-3 py-1.5 hover:bg-panel-3" target={h.url.startsWith("http") ? "_blank" : undefined}>
                    <span className="block truncate text-[13.5px] text-ink">{h.title}</span>
                    {h.subtitle && <span className="block truncate text-[11.5px] text-muted">{h.subtitle}</span>}
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
