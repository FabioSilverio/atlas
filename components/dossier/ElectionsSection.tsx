import { getCountryElections, type ElectionItem } from "@/lib/knowledge";
import { fmtDate, fmtNorm, sideLabel } from "@/lib/ui/labels";
import { css, divergingColor } from "@/lib/ui/palette";

// Categorical slots 1–3 (validated all-pairs on the dark surface).
const SERIES = ["#3987e5", "#d95926", "#199e70"];

const BODY_PT: Record<string, string> = {
  Presidente: "Presidência",
  "Chamber of Deputies": "Câmara dos Deputados",
  "Federal Senate": "Senado Federal",
  Senate: "Senado",
  "House of Representatives": "Câmara dos Representantes",
  "House of Commons": "Câmara dos Comuns",
  Bundestag: "Bundestag",
  "National Assembly": "Assembleia Nacional",
};
export const bodyPt = (b: string) => BODY_PT[b] ?? b;

export async function ElectionsSection({ code }: { code: string }) {
  const { elections, executive } = await getCountryElections(code);
  const recent = elections.slice(0, 4);
  return (
    <section className="px-4 py-4">
      <h3 className="label mb-2">Eleições e deriva ideológica</h3>
      <DriftChart elections={elections} executive={executive} />
      {recent.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-muted">Nenhuma eleição nacional com resultados estruturados na Wikipédia desde 2005.</p>
      ) : (
        <div className="mt-4 space-y-3">
          {recent.map((e, i) => (
            <ElectionCard key={e.id} e={e} open={i === 0} />
          ))}
        </div>
      )}
    </section>
  );
}

function ElectionCard({ e, open }: { e: ElectionItem; open: boolean }) {
  const top = e.results.slice(0, 7);
  return (
    <details className="group border border-line bg-panel-2" open={open}>
      <summary className="cursor-pointer list-none px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13px] text-ink">{e.kind === "presidential" ? "Eleição presidencial" : bodyPt(e.body)}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-2">{fmtDate(e.date)}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 font-mono text-[11px]">
          {e.status === "ongoing" && <span className="text-amber">em andamento</span>}
          {e.econ != null && (
            <span className="text-ink-2">
              {e.kind === "presidential" ? "voto ponderado" : "bancada ponderada"}: {sideLabel(e.econ, "econ_lr")} {fmtNorm(e.econ)}
            </span>
          )}
          {e.drift != null && Math.abs(e.drift) >= 0.03 && (
            <span className={e.drift > 0 ? "text-[#ff9f5e]" : "text-[#b3a8f5]"}>
              {e.drift > 0 ? "▲ deriva à direita" : "▼ deriva à esquerda"} {fmtNorm(e.drift)}
            </span>
          )}
          {e.coverage != null && e.coverage < 0.6 && <span className="text-muted">cobertura {Math.round(e.coverage * 100)}%</span>}
        </div>
      </summary>
      <div className="border-t border-line px-3 py-2">
        <table className="w-full font-mono text-[11px] tabular">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 font-normal">{e.kind === "presidential" ? "candidato" : "partido"}</th>
              <th className="py-1 pl-2 text-right font-normal">{e.kind === "presidential" ? "%" : "cadeiras"}</th>
              <th className="py-1 pl-2 text-right font-normal">pos.</th>
            </tr>
          </thead>
          <tbody>
            {top.map((r, i) => (
              <tr key={i} className="border-t border-line text-ink-2" title={r.scoreSource ?? "sem score acadêmico"}>
                <td className="max-w-[13rem] truncate py-1 pr-2">{e.kind === "presidential" ? `${r.candidate ?? "?"} (${r.party})` : r.party}</td>
                <td className="whitespace-nowrap py-1 pl-2 text-right text-ink">
                  {e.kind === "presidential" ? (r.share != null ? `${r.share.toFixed(1)}` : "—") : (r.seats ?? "—")}
                  {e.kind === "legislative" && r.seats != null && r.seatsBefore != null && r.seats !== r.seatsBefore && (
                    <span className={r.seats > r.seatsBefore ? "text-cyan" : "text-muted"}> {r.seats > r.seatsBefore ? "+" : "−"}{Math.abs(r.seats - r.seatsBefore)}</span>
                  )}
                </td>
                <td className="py-1 pl-2 text-right">
                  {r.econ != null ? (
                    <span className="inline-flex items-center gap-1">
                      <span className="inline-block size-2" style={{ background: css(divergingColor(r.econ)) }} />
                      {fmtNorm(r.econ)}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[10.5px] text-muted">
          Posição de cada partido pela melhor fonte acadêmica (passe o mouse). Resultados:{" "}
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer" className="underline decoration-line-strong hover:text-cyan">
              Wikipédia
            </a>
          )}
          .
        </p>
      </div>
    </details>
  );
}

/** x = year, y = economic position (up = right). Executive per year + each chamber at each election. */
function DriftChart({ elections, executive }: { elections: ElectionItem[]; executive: { year: number; econ: number | null; leader: string | null; party: string | null; label: string | null }[] }) {
  const W = 420;
  const H = 150;
  const pad = { l: 26, r: 8, t: 10, b: 18 };
  const now = new Date().getFullYear();
  const x0 = 2006;
  const x = (yr: number) => pad.l + ((yr - x0) / (now + 1 - x0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((1 - v) / 2) * (H - pad.t - pad.b);
  const yearOf = (d: string) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) - 1) / 12;

  const exec = executive.filter((e) => e.econ != null);
  const bodies = [...new Set(elections.filter((e) => e.kind === "legislative" && e.econ != null && (e.coverage ?? 0) >= 0.4).map((e) => e.body))].slice(0, 2);
  const series = [
    { name: "Chefe do executivo", color: SERIES[0], pts: exec.map((e) => ({ x: e.year + 0.5, v: e.econ!, tip: `${e.year}: ${e.leader ?? "?"}${e.party ? ` (${e.party})` : ""} ${fmtNorm(e.econ)}` })) },
    ...bodies.map((b, i) => ({
      name: bodyPt(b),
      color: SERIES[i + 1],
      pts: elections
        .filter((e) => e.body === b && e.econ != null && (e.coverage ?? 0) >= 0.4)
        .map((e) => ({ x: yearOf(e.date), v: e.econ!, tip: `${fmtDate(e.date)}: ${bodyPt(b)} ${fmtNorm(e.econ)} (cobertura ${Math.round((e.coverage ?? 0) * 100)}%)` }))
        .sort((a, b2) => a.x - b2.x),
    })),
  ].filter((s) => s.pts.length);

  if (!series.length) return <p className="text-[12.5px] text-muted">Sem série histórica com dado acadêmico suficiente.</p>;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Deriva ideológica no eixo econômico desde 2006">
        {[-1, -0.5, 0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--line-strong)" : "var(--line)"} strokeWidth={1} />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted)">
              {v === 1 ? "D" : v === -1 ? "E" : v === 0 ? "0" : ""}
            </text>
          </g>
        ))}
        {[2006, 2010, 2014, 2018, 2022, now].map((yr) => (
          <text key={yr} x={x(yr)} y={H - 5} textAnchor="middle" fontSize="8" fontFamily="var(--font-mono)" fill="var(--muted)">
            {yr}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.pts.map((p) => `${x(p.x)},${y(p.v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
            />
            {s.pts.map((p, i) => (
              <circle key={i} cx={x(p.x)} cy={y(p.v)} r={s.name === "Chefe do executivo" ? 2.2 : 4} fill={s.color} stroke="var(--panel)" strokeWidth={1.5}>
                <title>{p.tip}</title>
              </circle>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-2">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10.5px] leading-snug text-muted">
        Eixo econômico (−1 esquerda, +1 direita). Executivo: Herre (2023) até 2020, depois a posição atual do ATLAS. Casas legislativas: média das posições dos partidos ponderada pelas cadeiras, só quando ao menos 40% das cadeiras têm score.
      </p>
    </div>
  );
}
