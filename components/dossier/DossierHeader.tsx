import type { Dossier, DossierPerson } from "@/lib/queries";
import { REGIME_LABEL, ROLE_LABEL, fmtDate, subregionPt } from "@/lib/ui/labels";

const wd = (qid: string | null) => (qid ? `https://www.wikidata.org/wiki/${qid}` : undefined);

export function DossierHeader({ d }: { d: Dossier }) {
  const g = d.government;
  const daysToElection = g?.nextElection?.daysUntil ?? null;
  const leaderParties = g?.parties.filter((p) => p.role === "leader") ?? [];

  return (
    <section className="grid-bg relative px-4 pb-4 pt-5">
      <div className="flex items-start gap-3">
        {d.iso2 && <span className={`fi fi-${d.iso2.toLowerCase()} mt-1 shrink-0 text-[30px] shadow-[0_0_0_1px_var(--line-strong)]`} />}
        <div className="min-w-0">
          <h2 className="text-[22px] font-medium leading-tight text-ink">{d.name}</h2>
          <div className="mt-0.5 font-mono text-[11px] text-muted">
            {d.code} · {subregionPt(d.region) ?? "—"}
            {d.population ? ` · ${(d.population / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi hab.` : ""}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.regime && (
              <span className="border border-line-strong bg-panel px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2" title={`V-Dem Regimes of the World, dado de ${d.regimeYear}`}>
                {REGIME_LABEL[d.regime]} · {d.regimeYear}
              </span>
            )}
            {d.disputed && <span className="border border-amber-dim px-1.5 py-0.5 font-mono text-[10.5px] text-amber">TERRITÓRIO DISPUTADO</span>}
          </div>
        </div>
      </div>
      {d.disputeNote && <p className="mt-3 border-l-2 border-amber-dim pl-2 text-[12px] leading-snug text-ink-2">{d.disputeNote}</p>}

      {!g ? (
        <p className="mt-4 text-[13px] text-muted">Nenhum chefe de Estado ou de governo registrado no Wikidata para este território.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line">
          <Head role="head_of_state" person={g.hos} chief={g.chiefRole === "head_of_state"} />
          <Head role="head_of_government" person={g.hog} chief={g.chiefRole === "head_of_government"} />
          <div className="col-span-2 bg-panel px-3 py-2">
            <div className="label">Partido do chefe do executivo</div>
            <div className="mt-0.5 text-[13.5px] text-ink">
              {leaderParties.length ? leaderParties.map((p) => (
                <a key={p.qid ?? p.name} href={wd(p.qid)} target="_blank" rel="noreferrer" className="mr-2 hover:text-cyan">
                  {p.name}
                  {p.abbrev && p.abbrev !== p.name ? <span className="text-muted"> ({p.abbrev})</span> : null}
                </a>
              )) : <span className="text-muted">sem filiação registrada</span>}
            </div>
          </div>
          <div className="col-span-2 flex items-center justify-between gap-3 bg-panel px-3 py-2">
            <div>
              <div className="label">Próxima eleição nacional</div>
              {g.nextElection ? (
                <div className="mt-0.5 text-[13.5px] text-ink">
                  {g.nextElection.name} · <span className="font-mono">{fmtDate(g.nextElection.date)}</span>
                  {g.nextElection.confirmed === false && <span className="ml-1 font-mono text-[10.5px] text-amber">data não confirmada</span>}
                </div>
              ) : (
                <div className="mt-0.5 text-[12.5px] text-muted">Nenhuma no calendário de curto prazo do ElectionGuide.</div>
              )}
            </div>
            {daysToElection != null && daysToElection >= 0 && (
              <div className="text-right font-mono">
                <div className="text-[20px] leading-none text-amber tabular">{daysToElection}</div>
                <div className="text-[10px] text-muted">dias</div>
              </div>
            )}
          </div>
        </div>
      )}
      {g && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted">
          <span className="text-ink-2">Chefe do executivo: </span>
          {g.chiefRule}
        </p>
      )}
    </section>
  );
}

function Head({ role, person, chief }: { role: keyof typeof ROLE_LABEL; person: DossierPerson | null; chief: boolean }) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="label flex items-center gap-1.5">
        {ROLE_LABEL[role]}
        {chief && <span className="text-cyan" title="Tratado como chefe do executivo">◆</span>}
      </div>
      {person ? (
        <a href={wd(person.qid)} target="_blank" rel="noreferrer" className="mt-0.5 block text-[13.5px] leading-snug text-ink hover:text-cyan">
          {person.name}
        </a>
      ) : (
        <div className="mt-0.5 text-[13px] text-muted">—</div>
      )}
    </div>
  );
}
