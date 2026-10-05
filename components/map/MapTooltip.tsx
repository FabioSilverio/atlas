import type { MapCountry } from "@/lib/queries";
import type { LayerId } from "@/lib/ui/labels";
import { REGIME_LABEL, fmtDate, fmtNorm, sideLabel } from "@/lib/ui/labels";
import { css, divergingColor } from "@/lib/ui/palette";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

export function MapTooltip({ x, y, name, country, layer }: { x: number; y: number; name: string; country?: MapCountry; layer: LayerId }) {
  const dim = layer === "galtan" ? "galtan" : "econ_lr";
  const pos = layer === "galtan" ? country?.galtan : country?.econ;
  const el = country?.election;
  return (
    <div className="pointer-events-none absolute z-20 min-w-52 max-w-72 border border-line-strong bg-panel/95 px-3 py-2 shadow-2xl backdrop-blur-sm" style={{ left: x + 14, top: y + 14 }}>
      <div className="flex items-center gap-2">
        {country?.iso2 && <span className={`fi fi-${country.iso2.toLowerCase()} shrink-0 text-[12px]`} />}
        <span className="text-[13px] font-medium text-ink">{name}</span>
        {country?.disputed && <span className="font-mono text-[9.5px] tracking-wider text-amber">DISPUTADO</span>}
      </div>
      {country?.chief && <div className="mt-0.5 text-[12px] text-ink-2">{country.chief}</div>}
      <div className="mt-2 space-y-0.5 border-t border-line pt-1.5 font-mono text-[11px] tabular">
        {layer === "nobel" && <Row k="laureados (nascimento)" v={country?.nobel ?? 0} />}
        {layer === "thinkers" && <Row k="pensadores no acervo" v={country?.thinkers ?? 0} />}
        {layer === "themes" &&
          (country?.opinion ? (
            <>
              <Row k="colunas (30 dias)" v={country.opinion.articles} />
              {country.opinion.theme && <Row k="tema em alta" v={country.opinion.theme} />}
            </>
          ) : (
            <span className="text-muted">nenhum veículo monitorado</span>
          ))}
        {layer === "elections" &&
          (el ? (
            <>
              <Row k={el.kind === "presidential" ? "presidencial" : "legislativa"} v={fmtDate(el.date)} />
              <Row k="resultado" v={`${sideLabel(el.econ, "econ_lr")} ${fmtNorm(el.econ)}`} />
              <Row
                k="deriva"
                v={el.drift == null ? "—" : <span style={{ color: css(divergingColor(el.drift / 0.25)) }}>{Math.abs(el.drift) < 0.03 ? "estável" : el.drift > 0 ? `→ direita ${fmtNorm(el.drift)}` : `← esquerda ${fmtNorm(el.drift)}`}</span>}
              />
            </>
          ) : (
            <span className="text-muted">sem eleição com dado acadêmico</span>
          ))}
        {(layer === "econ" || layer === "galtan") &&
          (!pos ? (
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
          ))}
        {country?.regime && <div className="mt-1 text-muted">{REGIME_LABEL[country.regime]}</div>}
      </div>
      <div className="mt-1.5 font-mono text-[9.5px] tracking-wider text-cyan">CLIQUE PARA O DOSSIÊ</div>
    </div>
  );
}
