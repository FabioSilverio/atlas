"use client";

import { useMemo, useState } from "react";
import type { MapCountry } from "@/lib/queries";
import { LAYERS, type LayerId } from "@/lib/ui/labels";
import { CONFIDENCE_ALPHA, CONFIDENCE_TEXT, DIVERGING_STOPS, NOBEL_LEGEND, css, divergingColor } from "@/lib/ui/palette";

export function LayerPanel({ layer, onLayer, countries }: { layer: LayerId; onLayer: (l: LayerId) => void; countries: MapCountry[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const groups = [...new Set(LAYERS.map((l) => l.group))];

  const coverage = useMemo(() => {
    const withGov = countries.filter((c) => c.econ);
    const dim = layer === "galtan" ? "galtan" : "econ";
    const conf = { A: 0, B: 0, C: 0, D: 0, none: 0 };
    for (const c of withGov) {
      const p = c[dim];
      if (!p || p.v == null || !p.c) conf.none++;
      else conf[p.c]++;
    }
    return { total: withGov.length, conf };
  }, [countries, layer]);

  return (
    <div className="absolute left-3 top-3 z-10 w-[268px] border border-line-strong bg-panel/[0.96] backdrop-blur-sm">
      <button onClick={() => setCollapsed((c) => !c)} className="flex w-full items-center justify-between border-b border-line px-3 py-2" aria-expanded={!collapsed}>
        <span className="label">Camadas</span>
        <span className="font-mono text-[11px] text-muted">{collapsed ? "+" : "−"}</span>
      </button>
      {!collapsed && (
        <div className="scroll-thin max-h-[calc(100dvh-9rem)] overflow-y-auto">
          {groups.map((g) => (
            <div key={g} className="border-b border-line px-3 py-2.5">
              <div className="label mb-1.5">{g}</div>
              {LAYERS.filter((l) => l.group === g).map((l) => {
                const disabled = !!l.phase;
                const on = l.id === layer;
                return (
                  <button
                    key={l.id}
                    disabled={disabled}
                    onClick={() => onLayer(l.id as LayerId)}
                    className={`group flex w-full items-center gap-2 py-1 text-left text-[13px] ${disabled ? "cursor-not-allowed text-muted" : on ? "text-ink" : "text-ink-2 hover:text-ink"}`}
                  >
                    <span className={`inline-block size-2 border ${on ? "border-cyan bg-cyan" : "border-line-strong"}`} />
                    <span>{l.label}</span>
                    {disabled && <span className="ml-auto font-mono text-[10px] text-muted">fase {l.phase}</span>}
                  </button>
                );
              })}
            </div>
          ))}

          <div className="px-3 py-3">
            <div className="label mb-2">Legenda</div>
            {layer === "nobel" ? <NobelLegend /> : <DivergingLegend layer={layer} />}
            {layer !== "nobel" && (
              <>
                <div className="label mb-1.5 mt-4">Confiança (opacidade)</div>
                <div className="space-y-1">
                  {(["A", "B", "C", "D"] as const).map((c) => (
                    <div key={c} className="flex items-center gap-2 font-mono text-[11px]" title={CONFIDENCE_TEXT[c].long}>
                      <span className="relative inline-block h-3 w-6 overflow-hidden" style={{ background: css(divergingColor(0.8), CONFIDENCE_ALPHA[c]) }}>
                        {c === "D" && <Hatch />}
                      </span>
                      <span className="w-3 text-ink">{c}</span>
                      <span className="truncate text-muted">{CONFIDENCE_TEXT[c].long.split(",")[0].split(":")[0]}</span>
                      <span className="ml-auto tabular text-ink-2">{coverage.conf[c]}</span>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 font-mono text-[11px]">
                    <span className="relative inline-block h-3 w-6 overflow-hidden bg-[#1b2129]">
                      <Hatch />
                    </span>
                    <span className="w-3 text-ink">—</span>
                    <span className="text-muted">sem dado acadêmico</span>
                    <span className="ml-auto tabular text-ink-2">{coverage.conf.none}</span>
                  </div>
                </div>
                <p className="mt-3 text-[11.5px] leading-snug text-muted">
                  Contornos âmbar marcam territórios disputados. Posição = partido do chefe do executivo, pela melhor fonte acadêmica disponível.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Hatch() {
  return (
    <span
      className="absolute inset-0"
      style={{ backgroundImage: "repeating-linear-gradient(45deg, rgba(120,132,145,0.55) 0 1px, transparent 1px 5px)" }}
    />
  );
}

function DivergingLegend({ layer }: { layer: LayerId }) {
  const gradient = `linear-gradient(90deg, ${DIVERGING_STOPS.map(([v, h]) => `${h} ${((v + 1) / 2) * 100}%`).join(", ")})`;
  const [lo, hi] = layer === "galtan" ? ["Libertário / progressista", "Autoritário / tradicional"] : ["Esquerda (Estado)", "Direita (mercado)"];
  return (
    <div>
      <div className="h-2.5 w-full" style={{ background: gradient }} />
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted tabular">
        <span>−1</span>
        <span>0</span>
        <span>+1</span>
      </div>
      <div className="mt-0.5 flex justify-between text-[11.5px] text-ink-2">
        <span>{lo}</span>
        <span className="text-right">{hi}</span>
      </div>
    </div>
  );
}

function NobelLegend() {
  return (
    <div>
      <div className="flex">
        {NOBEL_LEGEND.map((s) => (
          <div key={s.from} className="flex-1">
            <div className="h-2.5" style={{ background: s.color }} />
            <div className="mt-1 font-mono text-[10px] text-muted tabular">{s.from}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-muted">Laureados por país de nascimento (fronteiras atuais) ou sede da organização. No dossiê dá para alternar para afiliação.</p>
    </div>
  );
}
