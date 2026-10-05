"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MapCountry } from "@/lib/queries";
import { fmtNorm, sideLabel } from "@/lib/ui/labels";
import { CONFIDENCE_ALPHA, css, divergingColor } from "@/lib/ui/palette";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Mobile replacement for the map: sortable list, each row opens the full-screen dossier. */
export function CountryList({ countries }: { countries: MapCountry[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "econ" | "nobel">("name");

  const list = useMemo(() => {
    const f = fold(q);
    const l = countries.filter((c) => c.econ && (!f || fold(c.name).includes(f)));
    if (sort === "econ") l.sort((a, b) => (a.econ?.v ?? 9) - (b.econ?.v ?? 9));
    if (sort === "nobel") l.sort((a, b) => b.nobel - a.nobel);
    return l;
  }, [countries, q, sort]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-2 border-b border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar países" className="h-9 min-w-0 flex-1 border border-line-strong bg-bg px-3 font-mono text-[13px] focus:border-cyan-dim focus:outline-none" />
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-9 border border-line-strong bg-bg px-2 font-mono text-[12px] text-ink-2" aria-label="Ordenar">
          <option value="name">A–Z</option>
          <option value="econ">esq. → dir.</option>
          <option value="nobel">Nobel</option>
        </select>
      </div>
      <ul className="scroll-thin flex-1 overflow-y-auto">
        {list.map((c) => (
          <li key={c.code}>
            <Link href={`/pais/${c.code}`} className="flex items-center gap-3 border-b border-line px-3 py-2.5 active:bg-panel-2">
              {c.iso2 ? <span className={`fi fi-${c.iso2.toLowerCase()} shrink-0 text-[15px]`} /> : <span className="w-5" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] text-ink">{c.name}</div>
                <div className="truncate text-[12px] text-muted">{c.chief ?? "—"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular">
                {c.econ?.v != null && c.econ.c ? (
                  <>
                    <span className="text-ink-2">{sideLabel(c.econ.v, "econ_lr")}</span>
                    <span className="inline-block size-3" style={{ background: css(divergingColor(c.econ.v), CONFIDENCE_ALPHA[c.econ.c]) }} title={`${fmtNorm(c.econ.v)} · conf. ${c.econ.c}`} />
                  </>
                ) : (
                  <span className="text-muted">sem dado</span>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
