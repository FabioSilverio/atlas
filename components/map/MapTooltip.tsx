import type { MapCountry } from "@/lib/queries";
import type { LayerId } from "@/lib/ui/labels";
import { REGIME_LABEL, fmtNorm, sideLabel } from "@/lib/ui/labels";
import { css, divergingColor } from "@/lib/ui/palette";

export function MapTooltip({ x, y, name, country, layer }: { x: number; y: number; name: string; country?: MapCountry; layer: LayerId }) {
  const dim = layer === "galtan" ? "galtan" : "econ_lr";
  const pos = layer === "galtan" ? country?.galtan : country?.econ;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-52 max-w-72 border border-line-strong bg-panel/95 px-3 py-2 shadow-2xl backdrop-blur-sm"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div className="flex items-center gap-2">
        {country?.iso2 && <span className={`fi fi-${country.iso2.toLowerCase()} shrink-0 text-[12px]`} />}
        <span className="text-[13px] font-medium text-ink">{name}</span>
        {country?.disputed && <span className="font-mono text-[9.5px] tracking-wider text-amber">DISPUTADO</span>}
      </div>
      {country?.chief && <div className="mt-0.5 text-[12px] text-ink-2">{country.chief}</div>}
      <div className="mt-2 border-t border-line pt-1.5 font-mono text-[11px] tabular">
        {layer === "nobel" ? (
          <div className="flex justify-between gap-4">
            <span className="text-muted">laureados (nascimento)</span>
            <span className="text-ink">{country?.nobel ?? 0}</span>
          </div>
        ) : !pos ? (
          <span className="text-muted">sem governo registrado</span>
        ) : pos.v == null ? (
          <span className="text-muted">sem dado acadêmico</span>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2.5" style={{ background: css(divergingColor(pos.v)) }} />
              <span className="text-ink">{sideLabel(pos.v, dim)}</span>
            </span>
            <span className="text-ink-2">
              {fmtNorm(pos.v)} · conf. {pos.c}
              {pos.est ? " · estimativa" : ""}
            </span>
          </div>
        )}
        {country?.regime && <div className="mt-1 text-muted">{REGIME_LABEL[country.regime]}</div>}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] tracking-wider text-cyan">CLIQUE PARA O DOSSIÊ</div>
    </div>
  );
}
