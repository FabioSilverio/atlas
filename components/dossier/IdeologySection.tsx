import type { Dossier, DossierPosition } from "@/lib/queries";
import { SOURCE_SHORT, type DerivationInput } from "@/lib/ideology/derive";
import { fmtNorm, sideLabel } from "@/lib/ui/labels";
import { CONFIDENCE_TEXT, css, divergingColor } from "@/lib/ui/palette";

const DIM = {
  econ_lr: { name: "Eixo econômico", lo: "esquerda", hi: "direita" },
  galtan: { name: "Eixo cultural (GAL–TAN)", lo: "libertário", hi: "autoritário" },
} as const;

export function IdeologySection({ d }: { d: Dossier }) {
  const g = d.government;
  if (!g) return null;
  const econ = g.positions.find((p) => p.dimension === "econ_lr");
  const gal = g.positions.find((p) => p.dimension === "galtan");
  return (
    <section className="px-4 py-4">
      <h3 className="label mb-3">Posição ideológica do governo</h3>
      <div className="flex gap-4">
        <Compass econ={econ?.v ?? null} gal={gal?.v ?? null} />
        <div className="min-w-0 flex-1 space-y-3">
          {[econ, gal].map((p) => p && <Readout key={p.dimension} p={p} />)}
        </div>
      </div>
      <div className="mt-4 space-y-4">{[econ, gal].map((p) => p && <Derivation key={p.dimension} p={p} />)}</div>
    </section>
  );
}

function Readout({ p }: { p: DossierPosition }) {
  const meta = DIM[p.dimension];
  return (
    <div>
      <div className="text-[11.5px] text-muted">{meta.name}</div>
      {p.v == null ? (
        <div className="text-[13.5px] text-muted">sem dado acadêmico</div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[15px] text-ink">{sideLabel(p.v, p.dimension)}</span>
          <span className="font-mono text-[12px] text-ink-2 tabular">{fmtNorm(p.v)}</span>
          {p.c && <ConfidenceBadge c={p.c} est={p.est} />}
        </div>
      )}
      <Scale v={p.v} />
    </div>
  );
}

function ConfidenceBadge({ c, est }: { c: NonNullable<DossierPosition["c"]>; est: boolean }) {
  return (
    <span title={CONFIDENCE_TEXT[c].long} className={`border px-1 font-mono text-[10px] ${c === "A" ? "border-cyan-dim text-cyan" : c === "D" ? "border-amber-dim text-amber" : "border-line-strong text-ink-2"}`}>
      CONF {c}
      {est ? " · ESTIMATIVA" : ""}
    </span>
  );
}

function Scale({ v }: { v: number | null }) {
  return (
    <div className="relative mt-1.5 h-1.5 w-full bg-panel-3">
      <div className="absolute left-1/2 top-[-2px] h-[10px] w-px bg-line-strong" />
      {v != null && (
        <div className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel" style={{ left: `${((v + 1) / 2) * 100}%`, background: css(divergingColor(v)) }} />
      )}
    </div>
  );
}

/** Two-axis compass. x = economic (left → right), y = cultural (libertarian bottom → authoritarian top). */
function Compass({ econ, gal }: { econ: number | null; gal: number | null }) {
  const S = 132;
  const pad = 14;
  const x = (v: number) => pad + ((v + 1) / 2) * (S - 2 * pad);
  const y = (v: number) => S - pad - ((v + 1) / 2) * (S - 2 * pad);
  return (
    <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="shrink-0" role="img" aria-label={`Bússola: econômico ${fmtNorm(econ)}, cultural ${fmtNorm(gal)}`}>
      <rect x={pad} y={pad} width={S - 2 * pad} height={S - 2 * pad} fill="var(--panel-2)" stroke="var(--line-strong)" />
      {[-0.5, 0.5].map((t) => (
        <g key={t} stroke="var(--line)">
          <line x1={x(t)} x2={x(t)} y1={pad} y2={S - pad} />
          <line y1={y(t)} y2={y(t)} x1={pad} x2={S - pad} />
        </g>
      ))}
      <line x1={x(0)} x2={x(0)} y1={pad} y2={S - pad} stroke="var(--line-strong)" />
      <line y1={y(0)} y2={y(0)} x1={pad} x2={S - pad} stroke="var(--line-strong)" />
      <g fontFamily="var(--font-mono)" fontSize="8.5" fill="var(--muted)">
        <text x={S / 2} y={9} textAnchor="middle">AUT</text>
        <text x={S / 2} y={S - 3} textAnchor="middle">LIB</text>
        <text x={3} y={S / 2 + 3}>E</text>
        <text x={S - 3} y={S / 2 + 3} textAnchor="end">D</text>
      </g>
      {econ != null && gal == null && (
        <line x1={x(econ)} x2={x(econ)} y1={pad} y2={S - pad} stroke={css(divergingColor(econ))} strokeWidth={2} strokeDasharray="3 3" />
      )}
      {econ != null && gal != null && (
        <circle cx={x(econ)} cy={y(gal)} r={5.5} fill={css(divergingColor(econ))} stroke="var(--cyan)" strokeWidth={1.5} />
      )}
      {econ == null && (
        <text x={S / 2} y={S / 2 - 6} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9" fill="var(--muted)">
          sem dado
        </text>
      )}
    </svg>
  );
}

function rawText(s: DerivationInput) {
  if (s.rawLabel) return s.rawLabel;
  if (s.rawValue == null) return "—";
  return `${Number(s.rawValue).toFixed(1)}/${s.scaleMax}`;
}

function sourceText(s: DerivationInput) {
  const name = SOURCE_SHORT[s.sourceId] ?? s.sourceId;
  return s.observedYear && !name.includes(String(s.observedYear)) ? `${name} ${s.observedYear}` : name;
}

function Derivation({ p }: { p: DossierPosition }) {
  const d = p.derivation;
  const rows = [d.chosen, ...d.alternatives].filter(Boolean) as DerivationInput[];
  return (
    <details className="group border border-line bg-panel-2" open={p.dimension === "econ_lr"}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2">
        <span className="text-[12.5px] text-ink">Como chegamos aqui · {DIM[p.dimension].name.toLowerCase()}</span>
        <span className="font-mono text-[11px] text-muted group-open:rotate-90">›</span>
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-2.5 text-[12.5px] leading-snug text-ink-2">
        <p>{d.explanation}</p>
        {rows.length > 0 && (
          <table className="w-full font-mono text-[11px] tabular">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 font-normal">fonte</th>
                <th className="py-1 font-normal">registro</th>
                <th className="py-1 pl-2 text-right font-normal">bruto</th>
                <th className="py-1 pl-2 text-right font-normal">norm.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id} className={`border-t border-line ${i === 0 ? "text-ink" : "text-ink-2"}`}>
                  <td className="py-1 pr-2 align-top">
                    {i === 0 && <span className="text-cyan">▸ </span>}
                    {sourceText(s)}
                  </td>
                  <td className="max-w-[8rem] truncate py-1 pr-2 align-top" title={s.subjectName ?? ""}>
                    {s.subjectName ?? "—"}
                  </td>
                  <td className="whitespace-nowrap py-1 pl-2 text-right align-top">{rawText(s)}</td>
                  <td className="whitespace-nowrap py-1 pl-2 text-right align-top">{fmtNorm(s.valueNorm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 1 && <p className="text-[11.5px] text-muted">Fontes não são misturadas: vale a primeira da hierarquia; as demais ficam como referência.</p>}
        {d.caveats.map((c) => (
          <p key={c} className="border-l-2 border-line-strong pl-2 text-[11.5px] text-muted">
            {c}
          </p>
        ))}
      </div>
    </details>
  );
}
