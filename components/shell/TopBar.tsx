"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapCountry, Stats } from "@/lib/queries";
import { fmtDate } from "@/lib/ui/labels";
import { Counter } from "@/components/ui/Counter";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function TopBar({ stats, countries, onSelect, pending }: { stats: Stats; countries: MapCountry[]; onSelect: (code: string) => void; pending: boolean }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return [];
    return countries
      .filter((c) => fold(c.name).includes(f) || c.code.toLowerCase() === f || (c.chief && fold(c.chief).includes(f)))
      .sort((a, b) => Number(!fold(a.name).startsWith(f)) - Number(!fold(b.name).startsWith(f)))
      .slice(0, 8);
  }, [q, countries]);

  // "/" focuses search, like most consoles.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const pick = (code: string) => {
    setQ("");
    setOpen(false);
    input.current?.blur();
    onSelect(code);
  };

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-3 md:px-4">
      <Link href="/" className="flex items-baseline gap-2">
        <span className="font-mono text-[15px] font-medium tracking-[0.32em] text-ink">ATLAS</span>
        <span className="hidden font-mono text-[10px] tracking-widest text-muted lg:inline">IDEIAS · PENSADORES · PODER</span>
      </Link>

      <div className="relative min-w-0 flex-1 md:max-w-md">
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            if (e.key === "Enter" && results[active]) pick(results[active].code);
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder="Buscar país ou chefe de governo"
          aria-label="Busca global"
          className="h-8 w-full border border-line-strong bg-bg px-3 pr-8 font-mono text-[12.5px] text-ink placeholder:text-muted focus:border-cyan-dim focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 border border-line-strong px-1 font-mono text-[10px] text-muted md:block">/</kbd>
        {open && q && (
          <div className="absolute left-0 right-0 top-9 border border-line-strong bg-panel shadow-2xl">
            {results.length === 0 ? (
              <div className="px-3 py-2 font-mono text-[11.5px] text-muted">Nada encontrado. Busca por pessoas, ideias e ideologias chega nas Fases 2–5.</div>
            ) : (
              results.map((c, i) => (
                <button
                  key={c.code}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.code)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === active ? "bg-panel-3" : ""}`}
                >
                  {c.iso2 && <span className={`fi fi-${c.iso2.toLowerCase()} text-[11px]`} />}
                  <span className="text-[13px] text-ink">{c.name}</span>
                  <span className="ml-auto truncate font-mono text-[11px] text-muted">{c.chief ?? c.code}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <dl className="ml-auto hidden items-center gap-5 font-mono text-[11px] lg:flex">
        <Stat label="governos" value={stats.countries} />
        <Stat label="com posição" value={stats.classified} />
        <Stat label="laureados" value={stats.laureates} />
        <div className="flex items-center gap-1.5 text-muted">
          <span className={`inline-block size-1.5 rounded-full ${pending ? "bg-amber live-dot" : "bg-cyan"}`} />
          <span title={stats.updatedAt ?? ""}>sync {fmtDate(stats.updatedAt, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </dl>
      <Link href="/metodologia" className="hidden font-mono text-[11px] text-ink-2 hover:text-cyan md:block">
        metodologia
      </Link>
    </header>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="tabular text-[13px] text-ink">
        <Counter value={value} />
      </dd>
      <dt className="text-muted">{label}</dt>
    </div>
  );
}
