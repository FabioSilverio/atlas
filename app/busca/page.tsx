import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page/PageShell";
import { KIND_LABEL, search, type SearchHit } from "@/lib/search";

export const metadata: Metadata = { title: "Busca" };

export default async function SearchPage({ searchParams }: PageProps<"/busca">) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const hits = q.trim().length >= 2 ? await search(q, 80) : [];
  const groups = new Map<string, SearchHit[]>();
  for (const h of hits) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);
  return (
    <PageShell wide>
      <div className="label">Busca global</div>
      <form action="/busca" className="mt-2 flex gap-2">
        <input
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
      {q && !hits.length && <p className="mt-8 text-[14px] text-muted">Nada encontrado para “{q}”.</p>}
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
    </PageShell>
  );
}
