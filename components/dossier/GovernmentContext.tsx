import Link from "next/link";
import type { ContextPerson } from "@/lib/db/schema";
import { getGovernmentContext } from "@/lib/knowledge";
import { fmtDate, fmtNorm } from "@/lib/ui/labels";
import { bodyPt } from "./ElectionsSection";
import { Avatar } from "./ThinkersSection";

const years = (from: string | null) => {
  if (!from) return null;
  const d = (Date.now() - new Date(from).getTime()) / (365.25 * 864e5);
  return d < 1 ? `${Math.max(1, Math.round(d * 12))} meses` : `${d.toFixed(1).replace(".", ",")} anos`;
};

export async function GovernmentContext({ code }: { code: string }) {
  const c = await getGovernmentContext(code);
  if (!c || (!c.party && !c.leader)) return null;
  const { party, leader, rise, latest, strength } = c;
  return (
    <section className="px-4 py-4">
      <h3 className="label mb-3">Governo em contexto</h3>

      {leader && (leader.summary || leader.description) && (
        <div className="mb-4 flex gap-3">
          {leader.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={leader.imageUrl} alt={`Retrato de ${leader.name}`} className="h-20 w-16 shrink-0 border border-line-strong object-cover grayscale" loading="lazy" />
          )}
          <div className="min-w-0">
            <div className="label">Quem é o líder</div>
            <div className="text-[14px] text-ink">
              {leader.name}
              {leader.birthYear && <span className="ml-1.5 font-mono text-[11px] text-muted">n. {leader.birthYear}</span>}
            </div>
            {leader.description && <div className="text-[12px] text-muted">{leader.description}</div>}
            {leader.summary && (
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">
                {leader.summary}{" "}
                <a href={leader.summaryUrl ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-muted underline">
                  Wikipédia
                </a>
              </p>
            )}
          </div>
        </div>
      )}

      {party && (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <a href={`https://www.wikidata.org/wiki/${party.qid}`} target="_blank" rel="noreferrer" className="text-[14px] text-ink hover:text-cyan">
              {party.name}
            </a>
            {party.founded && <span className="shrink-0 font-mono text-[11px] text-muted">fundado em {party.founded.slice(0, 4)}</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {party.alignment.map((a) => (
              <span key={a} className="border border-line-strong px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2" title="Posição política declarada (Wikidata P1387)">
                {a}
              </span>
            ))}
            {party.ideologies.slice(0, 10).map((i) => (
              <Link key={i.qid} href={`/ideologia/${i.qid}`} className="border border-cyan-dim/60 px-1.5 py-0.5 text-[11px] text-ink-2 hover:text-cyan" title="Ideologia declarada (Wikidata P1142)">
                {i.label}
              </Link>
            ))}
          </div>
          {party.ideologies.length > 10 && <span className="font-mono text-[10px] text-muted">+{party.ideologies.length - 10} rótulos</span>}
          {party.summary && (
            <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2">
              {party.summary}{" "}
              <a href={party.summaryUrl ?? "#"} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-muted underline">
                Wikipédia
              </a>
            </p>
          )}
          {(party.founders.length > 0 || party.chair) && (
            <p className="mt-1.5 font-mono text-[10.5px] text-muted">
              {party.founders.length > 0 && `fundadores: ${party.founders.join(", ")}`}
              {party.founders.length > 0 && party.chair && " · "}
              {party.chair && `presidente do partido: ${party.chair}`}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line">
        <Cell label="No poder desde">
          {leader?.since ? (
            <>
              {fmtDate(leader.since)} <span className="text-muted">· {years(leader.since)}</span>
            </>
          ) : (
            "—"
          )}
        </Cell>
        <Cell label="Força no legislativo">
          {strength ? (
            <>
              {strength.seats}/{strength.total} cadeiras <span className="text-muted">· {Math.round((strength.seats / strength.total) * 100)}%</span>
              <div className="font-mono text-[10px] text-muted">
                {bodyPt(strength.body)}, {strength.date.slice(0, 4)}
                {party && !strength.label.toLowerCase().includes(party.name.toLowerCase().slice(0, 6)) && ` · como ${strength.label}`}
              </div>
            </>
          ) : (
            <span className="text-muted">sem dado</span>
          )}
        </Cell>
      </div>

      <div className="mt-3">
        <div className="label mb-1">Como chegou lá</div>
        {rise ? (
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            {rise.matched === "candidate" ? (
              <>
                {rise.election.kind === "presidential" ? "Eleição presidencial" : bodyPt(rise.election.body)} de {fmtDate(rise.election.date)}:{" "}
                <span className="text-ink">{rise.winnerRow?.candidate ?? leader?.name}</span>
                {rise.winnerRow?.share != null && ` (${rise.winnerRow.share.toFixed(1)}%${rise.election.status === "ongoing" ? ", 1º turno" : ""})`}
                {rise.opponent && (
                  <>
                    {" "}
                    contra <span className="text-ink">{rise.opponent.candidate ?? rise.opponent.party}</span>
                    {rise.opponent.share != null && ` (${rise.opponent.share.toFixed(1)}%)`}
                    {rise.opponent.party && rise.opponent.candidate && <span className="text-muted">, {rise.opponent.party}</span>}
                  </>
                )}
                .
              </>
            ) : (
              <>
                Eleição para {bodyPt(rise.election.body)} de {fmtDate(rise.election.date)}
                {rise.winnerRow?.seats != null && (
                  <>
                    : o partido fez <span className="text-ink">{rise.winnerRow.seats}</span> cadeiras
                  </>
                )}
                {rise.opponent && (
                  <>
                    ; principal rival: <span className="text-ink">{rise.opponent.party}</span>
                    {rise.opponent.seats != null && ` (${rise.opponent.seats})`}
                  </>
                )}
                .
              </>
            )}{" "}
            {rise.election.url && (
              <a href={rise.election.url} target="_blank" rel="noreferrer" className="font-mono text-[10px] text-muted underline">
                resultados
              </a>
            )}
          </p>
        ) : (
          <p className="text-[12.5px] text-muted">Sem eleição correspondente nos dados estruturados (governos não eleitos, sucessões ou eleição sem infobox).</p>
        )}
      </div>

      {latest && latest !== rise?.election && (
        <div className="mt-3">
          <div className="label mb-1">Situação atual</div>
          <p className="text-[12.5px] leading-relaxed text-ink-2">
            Última eleição: {latest.kind === "presidential" ? "presidencial" : bodyPt(latest.body)} em {fmtDate(latest.date)}
            {latest.status === "ongoing" && <span className="text-amber"> (em andamento)</span>}
            {latest.kind === "presidential" && latest.results[0]?.candidate && (
              <>
                {" "}
                — à frente: <span className="text-ink">{latest.results[0].candidate}</span>
                {latest.results[0].share != null && ` ${latest.results[0].share.toFixed(1)}%`}
                {latest.results[1]?.candidate && ` × ${latest.results[1].candidate}${latest.results[1].share != null ? ` ${latest.results[1].share.toFixed(1)}%` : ""}`}
              </>
            )}
            {latest.drift != null && Math.abs(latest.drift) >= 0.03 && (
              <span className={latest.drift > 0 ? "text-[#ff9f5e]" : "text-[#b3a8f5]"}>
                {" "}
                · deriva {latest.drift > 0 ? "à direita" : "à esquerda"} {fmtNorm(latest.drift)}
              </span>
            )}
            .
          </p>
        </div>
      )}

      {leader && (leader.ideologies.length > 0 || leader.influencedBy.length > 0) && (
        <div className="mt-3">
          <div className="label mb-1">Rótulos atribuídos a {leader.name}</div>
          <p className="text-[12px] leading-relaxed text-ink-2">
            {leader.ideologies.map((i) => i.label).join(" · ")}
            {leader.influencedBy.length > 0 && <span className="text-muted"> · influências registradas: {leader.influencedBy.map((i) => i.label).join(", ")}</span>}
          </p>
          <p className="mt-0.5 text-[10.5px] text-muted">Atribuições de terceiros registradas no Wikidata (P1142, P737), com fontes no próprio Wikidata; podem ser contestadas.</p>
        </div>
      )}

      <People title="Intelectuais filiados ao partido no poder" note="Filiação registrada no Wikidata (P102); comentaristas, teóricos, economistas, escritores não-políticos." people={c.affiliated} />
      <People
        title="Contemporâneos com os mesmos rótulos ideológicos"
        note="Compatriotas vivos que compartilham rótulos ideológicos (P1142) com o partido ou o líder. Afinidade declarada, não vínculo com o governo."
        people={c.sharedIdeology}
        showShared
      />
      {c.tradition.length > 0 && (
        <div className="mt-4">
          <div className="label mb-1.5">Tradição intelectual das ideologias do partido</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {c.tradition.map((t) => (
              <Link key={t.qid} href={`/pensador/${t.qid}`} className="text-[12.5px] text-ink-2 hover:text-cyan">
                {t.name}
                <span className="font-mono text-[10px] text-muted"> {t.country}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-panel px-3 py-2">
      <div className="label">{label}</div>
      <div className="mt-0.5 text-[12.5px] text-ink">{children}</div>
    </div>
  );
}

function People({ title, note, people, showShared = false }: { title: string; note: string; people: ContextPerson[]; showShared?: boolean }) {
  return (
    <div className="mt-4">
      <div className="label mb-1">{title}</div>
      <p className="mb-1.5 text-[10.5px] leading-snug text-muted">{note}</p>
      {people.length === 0 ? (
        <p className="text-[12px] text-muted">Nenhum encontrado no Wikidata.</p>
      ) : (
        <ul className="space-y-px">
          {people.map((p) => (
            <li key={p.qid}>
              <a href={`https://www.wikidata.org/wiki/${p.qid}`} target="_blank" rel="noreferrer" className="flex items-center gap-2.5 bg-panel-2 px-2.5 py-1.5 hover:bg-panel-3">
                <Avatar t={p} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-ink">{p.name}</div>
                  <div className="truncate text-[11px] text-muted">{showShared && p.shared?.length ? p.shared.join(", ") : (p.description ?? p.occupations.join(", "))}</div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
