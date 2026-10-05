"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MapCountry, Stats } from "@/lib/queries";
import { fmtDate } from "@/lib/ui/labels";
import { Counter } from "@/components/ui/Counter";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type Hit = { kind: string; ref: string; title: string; subtitle: string | null; url: string; countryCode: string | null };
const KIND: Record<string, string> = { country: "país", person: "pessoa", thinker: "pensador", party: "partido", ideology: "ideologia", theme: "tema", election: "eleição", laureate: "nobel" };

export function TopBar({ stats, countries, onSelect, pending }: { stats: Stats; countries: MapCountry[]; onSelect: (code: string) => void; pending: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Hit[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const local = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return [];
    return countries
      .filter((c) => fold(c.name).includes(f) || c.code.toLowerCase() === f || (c.chief && fold(c.chief).includes(f)))
      .sort((a, b) => Number(!fold(a.name).startsWith(f)) - Number(!fold(b.name).startsWith(f)))
      .slice(0, 5)
      .map((c): Hit => ({ kind: "country", ref: c.code, title: c.name, subtitle: c.chief, url: `/?pais=${c.code}`, countryCode: c.code }));
  }, [q, countries]);

  // Everything else (people, thinkers, ideologies, themes…) from the search index, debounced.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const { hits } = (await res.json()) as { hits: Hit[] };
        setRemote(hits.filter((h) => h.kind !== "country"));
      } catch {}
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const results = q.trim().length >= 2 ? [...local, ...remote].slice(0, 12) : local;

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

  const pick = (h: Hit | undefined) => {
    setOpen(false);
    input.current?.blur();
    if (!h) {
      if (q.trim()) router.push(`/busca?q=${encodeURIComponent(q.trim())}`);
      return;
    }
    setQ("");
    if (h.kind === "country") onSelect(h.ref);
    else if (h.url.startsWith("http")) window.open(h.url, "_blank", "noopener");
    else router.push(h.url);
  };

  return (
    <header className="relative z-30 flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-3 md:px-4">
      <Link href="/" className="flex items-baseline gap-2">
        <span className="font-mono text-[15px] font-medium tracking-[0.32em] text-ink">ATLAS</span>
        <span className="hidden font-mono text-[10px] tracking-widest text-muted xl:inline">IDEIAS · PENSADORES · PODER</span>
      </Link>

      <div className="relative min-w-0 flex-1 md:max-w-md">
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
            if (e.target.value.trim().length < 2) setRemote([]);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
            if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            if (e.key === "Enter") pick(results[active]);
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder="Buscar país, pessoa, pensador, ideologia, tema"
          aria-label="Busca global"
          className="h-8 w-full border border-line-strong bg-bg px-3 pr-8 font-mono text-[12.5px] text-ink placeholder:text-muted focus:border-cyan-dim focus:outline-none"
        />
        <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 border border-line-strong px-1 font-mono text-[10px] text-muted md:block">/</kbd>
        {open && q && (
          <div className="absolute left-0 right-0 top-9 border border-line-strong bg-panel shadow-2xl">
            {results.length === 0 ? (
              <div className="px-3 py-2 font-mono text-[11.5px] text-muted">Nada encontrado.</div>
            ) : (
              results.map((h, i) => (
                <button
                  key={h.kind + h.ref}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(h)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === active ? "bg-panel-3" : ""}`}
                >
                  <span className="w-16 shrink-0 font-mono text-[9.5px] uppercase tracking-wider text-muted">{KIND[h.kind] ?? h.kind}</span>
                  <span className="truncate text-[13px] text-ink">{h.title}</span>
                  <span className="ml-auto truncate font-mono text-[10.5px] text-muted">{h.subtitle}</span>
                </button>
              ))
            )}
            <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(undefined)} className="w-full border-t border-line px-3 py-1.5 text-left font-mono text-[11px] text-cyan">
              ver todos os resultados para “{q}” ↵
            </button>
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
      <nav className="hidden items-center gap-3 font-mono text-[11px] text-ink-2 md:flex">
        <Link href="/pensadores" className="hover:text-cyan">pensadores</Link>
        <Link href="/ideologias" className="hover:text-cyan">ideologias</Link>
        <Link href="/metodologia" className="hover:text-cyan">metodologia</Link>
      </nav>
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
