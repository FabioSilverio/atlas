"use client";

import { useMemo, useState } from "react";
import type { NobelEntry } from "@/lib/queries";
import { NOBEL_CATEGORY } from "@/lib/ui/labels";

type Basis = "origin" | "affiliation";

export function NobelSection({ entries }: { entries: NobelEntry[] }) {
  const [basis, setBasis] = useState<Basis>("origin");
  const [cat, setCat] = useState<string>("all");

  const byBasis = useMemo(
    () => entries.filter((e) => (basis === "origin" ? e.relation === "birth" || e.relation === "org_seat" : e.relation === "affiliation")),
    [entries, basis],
  );
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of byBasis) m[e.category] = (m[e.category] ?? 0) + 1;
    return m;
  }, [byBasis]);
  const shown = cat === "all" ? byBasis : byBasis.filter((e) => e.category === cat);

  return (
    <section className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="label">Prêmios Nobel</h3>
        <div className="flex border border-line-strong font-mono text-[10.5px]" role="tablist" aria-label="Critério de atribuição">
          {(
            [
              ["origin", "nascimento"],
              ["affiliation", "afiliação"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={basis === k} onClick={() => setBasis(k)} className={`px-2 py-0.5 ${basis === k ? "bg-panel-3 text-cyan" : "text-muted hover:text-ink"}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="mb-2 text-[11.5px] leading-snug text-muted">
        {basis === "origin"
          ? "Laureados nascidos neste território (fronteiras atuais) ou organizações sediadas nele."
          : "Laureados cuja instituição, na época do prêmio, ficava neste território (fronteiras atuais)."}
      </p>

      <div className="mb-3 flex flex-wrap gap-1">
        <Chip on={cat === "all"} onClick={() => setCat("all")} label="Todas" n={byBasis.length} />
        {Object.entries(NOBEL_CATEGORY).map(([k, l]) => (
          <Chip key={k} on={cat === k} onClick={() => setCat(k)} label={l} n={counts[k] ?? 0} />
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-[12.5px] text-muted">Nenhum laureado por este critério.</p>
      ) : (
        <ol className="space-y-px">
          {shown.map((e) => (
            <li key={`${e.laureateId}-${e.year}-${e.category}`} className="grid grid-cols-[3rem_1fr] gap-2 bg-panel-2 px-2.5 py-1.5">
              <span className="font-mono text-[12px] text-ink-2 tabular">{e.year}</span>
              <div className="min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <a href={e.url} target="_blank" rel="noreferrer" className="truncate text-[13px] text-ink hover:text-cyan">
                    {e.name}
                  </a>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted">{NOBEL_CATEGORY[e.category] ?? e.category}</span>
                </div>
                {e.motivation && <p className="mt-0.5 line-clamp-2 text-[11.5px] italic leading-snug text-muted" lang="en">{e.motivation}</p>}
                {basis === "affiliation" && e.affiliation && <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted">{e.affiliation}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[10.5px] text-muted">Motivações oficiais em inglês (nobelprize.org).</p>
    </section>
  );
}

function Chip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }) {
  return (
    <button onClick={onClick} disabled={n === 0 && !on} className={`border px-1.5 py-0.5 font-mono text-[10.5px] ${on ? "border-cyan-dim text-cyan" : n === 0 ? "border-line text-muted/50" : "border-line-strong text-ink-2 hover:text-ink"}`}>
      {label} <span className="tabular opacity-70">{n}</span>
    </button>
  );
}
