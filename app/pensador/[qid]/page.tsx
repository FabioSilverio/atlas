import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/dossier/ThinkersSection";
import { Chips, PageShell, Section } from "@/components/page/PageShell";
import { getThinker, type ThinkerCard } from "@/lib/knowledge";
import { NOBEL_CATEGORY, fmtDate } from "@/lib/ui/labels";

export async function generateMetadata({ params }: PageProps<"/pensador/[qid]">): Promise<Metadata> {
  const t = await getThinker((await params).qid);
  return { title: t ? t.name : "Pensador não encontrado", description: t?.description ?? undefined };
}

const life = (t: ThinkerCard) => {
  const y = (n: number) => (n < 0 ? `${-n} a.C.` : String(n));
  if (!t.birthYear) return null;
  return t.deathYear ? `${y(t.birthYear)}–${y(t.deathYear)}` : `${y(t.birthYear)}–`;
};

export default async function ThinkerPage({ params }: PageProps<"/pensador/[qid]">) {
  const { qid } = await params;
  const t = await getThinker(qid);
  if (!t) notFound();
  const ideologyQids = new Set(t.ideologies.map((i) => i.qid));
  const citizenship = t.countries.filter((c) => c.relation === "citizenship");
  const birth = t.countries.filter((c) => c.relation === "birth");
  const maxMentions = Math.max(1, ...t.mentions.map((m) => m.n));

  return (
    <PageShell back={{ href: t.country ? `/?pais=${t.country}&camada=thinkers` : "/", label: "← mapa" }}>
      <div className="flex gap-5">
        <div className="shrink-0">
          {t.imageUrl ? (
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.imageUrl} alt={`Retrato de ${t.name}`} className="w-32 border border-line-strong object-cover grayscale" />
              {t.imageAttribution && (
                <figcaption className="mt-1 w-32 text-[9.5px] leading-tight text-muted">
                  {t.imageAttribution.split(" · ")[0]}
                  {t.imageLicense ? ` · ${t.imageLicense}` : ""} ·{" "}
                  <a href={t.imageAttribution.split(" · ")[1]} target="_blank" rel="noreferrer" className="underline">
                    Commons
                  </a>
                </figcaption>
              )}
            </figure>
          ) : (
            <Avatar t={t} size={96} />
          )}
        </div>
        <div className="min-w-0">
          <div className="label">Pensador</div>
          <h1 className="mt-1 text-[28px] font-medium leading-tight text-ink">{t.name}</h1>
          <div className="mt-1 font-mono text-[12px] text-muted">
            {[life(t), citizenship.map((c) => c.name).join(", ") || birth.map((c) => c.name).join(", ")].filter(Boolean).join(" · ")}
          </div>
          {t.description && <p className="mt-2 text-[14px] text-ink-2">{t.description}</p>}
          <div className="mt-3">
            <Chips items={t.occupations} />
          </div>
        </div>
      </div>

      {t.summary && (
        <Section title="Biografia curta">
          <p className="text-[15px] leading-relaxed text-ink-2">{t.summary}</p>
          <p className="mt-1 font-mono text-[10.5px] text-muted">
            Trecho da{" "}
            <a href={t.summaryUrl ?? "#"} target="_blank" rel="noreferrer" className="underline">
              Wikipédia
            </a>{" "}
            (CC BY-SA 4.0).
          </p>
        </Section>
      )}

      <Section title="Principais teses" aside={<span className="font-mono text-[10.5px] text-muted">IA local · a partir da Wikipédia</span>}>
        {t.theses?.length ? (
          <>
            <ol className="space-y-2.5">
              {t.theses.map((s, i) => (
                <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-ink">
                  <span className="mt-0.5 font-mono text-[11px] text-cyan">{String(i + 1).padStart(2, "0")}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {t.concepts.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="mr-1 text-[12px] text-muted">Conceitos-chave:</span>
                {t.concepts.map((c) => (
                  <span key={c} className="border border-cyan-dim/60 px-1.5 py-0.5 text-[12.5px] text-ink-2">
                    {c}
                  </span>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] leading-snug text-muted">
              Síntese gerada pelo modelo aberto {t.thesesModel ?? "local"} a partir do{" "}
              <a href={t.thesesSource ?? "#"} target="_blank" rel="noreferrer" className="underline">
                verbete da Wikipédia
              </a>
              {t.thesesAt ? ` em ${fmtDate(t.thesesAt)}` : ""}. É um resumo automático: confira na fonte antes de citar.
            </p>
          </>
        ) : (
          <p className="text-[13px] text-muted">
            Em processamento: a IA local está extraindo as teses dos pensadores em ordem de notabilidade (a cada 4 horas). Enquanto isso, veja a biografia e as obras.
          </p>
        )}
      </Section>

      <Section title="Ideias centrais">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[12px] text-muted">Campos de trabalho</div>
            <Chips items={t.fields} />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] text-muted">Movimentos e ideologias</div>
            <Chips items={[...t.movements, ...t.ideologies.filter((i) => !t.movements.some((m) => m.qid === i.qid)).map((i) => ({ qid: i.qid, label: i.name }))]} href={(q) => (ideologyQids.has(q) || t.movements.some((m) => m.qid === q) ? `/ideologia/${q}` : null)} />
          </div>
        </div>
      </Section>

      <Section title="Obras-chave">
        {t.notableWorks.length ? (
          <ul className="grid gap-1 sm:grid-cols-2">
            {t.notableWorks.map((w) => (
              <li key={w.qid} className="text-[14px] italic text-ink-2">
                {w.label}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nenhuma obra registrada no Wikidata (P800).</p>
        )}
      </Section>

      {(t.awards.length > 0 || t.nobel.length > 0) && (
        <Section title="Prêmios">
          <ul className="space-y-1 text-[14px] text-ink-2">
            {t.nobel.map((n) => (
              <li key={n.year + n.category} className="text-ink">
                Nobel de {NOBEL_CATEGORY[n.category] ?? n.category} · {n.year}
              </li>
            ))}
            {t.awards.filter((a) => !/Nobel/i.test(a.label)).map((a) => (
              <li key={a.qid}>{a.label}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Linhagem intelectual" aside={<span className="font-mono text-[10.5px] text-muted">Wikidata P737</span>}>
        <Lineage t={t} />
      </Section>

      <Section title="Onde é citado" aside={<span className="font-mono text-[10.5px] text-muted">colunas de opinião monitoradas</span>}>
        {t.mentions.length ? (
          <ul className="space-y-1">
            {t.mentions.map((m) => (
              <li key={m.country} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-2 text-[13px]">
                <Link href={`/?pais=${m.country}`} className="truncate text-ink-2 hover:text-cyan">
                  {m.name}
                </Link>
                <span className="h-2 bg-cyan-dim" style={{ width: `${(m.n / maxMentions) * 100}%` }} />
                <span className="text-right font-mono text-[11px] text-ink tabular">{m.n}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Ainda não aparece nos títulos das colunas de opinião que o ATLAS monitora.</p>
        )}
      </Section>

      <p className="mt-10 font-mono text-[10.5px] text-muted">
        Fonte:{" "}
        <a href={`https://www.wikidata.org/wiki/${t.qid}`} target="_blank" rel="noreferrer" className="underline">
          Wikidata {t.qid}
        </a>{" "}
        · atualizado em {fmtDate(t.updatedAt)} · presença em {t.sitelinks} edições da Wikipédia
      </p>
    </PageShell>
  );
}

const short = (n: string) => (n.length > 26 ? `${n.slice(0, 25)}…` : n);

/** Ego network: influences on the left, those influenced on the right. */
function Lineage({ t }: { t: Awaited<ReturnType<typeof getThinker>> & object }) {
  const left = t.influencedBy.slice(0, 12);
  const right = t.influenced.slice(0, 12);
  if (!left.length && !right.length) return <p className="text-[13px] text-muted">Sem relações de influência registradas.</p>;
  const rowH = 26;
  const H = Math.max(left.length, right.length, 1) * rowH + 20;
  const W = 640;
  const cx = W / 2;
  const cy = H / 2;
  const ly = (i: number, n: number) => H / 2 + (i - (n - 1) / 2) * rowH;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[560px]" role="img" aria-label={`Influências de ${t.name}`}>
        {left.map((p, i) => (
          <path key={p.qid} d={`M ${180} ${ly(i, left.length)} C ${cx - 60} ${ly(i, left.length)}, ${cx - 80} ${cy}, ${cx - 70} ${cy}`} fill="none" stroke="var(--line-strong)" />
        ))}
        {right.map((p, i) => (
          <path key={p.qid} d={`M ${cx + 70} ${cy} C ${cx + 80} ${cy}, ${cx + 60} ${ly(i, right.length)}, ${W - 180} ${ly(i, right.length)}`} fill="none" stroke="var(--cyan-dim)" />
        ))}
        <rect x={cx - 70} y={cy - 14} width={140} height={28} fill="var(--panel-3)" stroke="var(--cyan)" />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fill="var(--text)">
          {t.name.length > 20 ? `${t.name.slice(0, 19)}…` : t.name}
        </text>
        {left.map((p, i) => (
          <a key={p.qid} href={`/pensador/${p.qid}`}>
            <text x={176} y={ly(i, left.length) + 4} textAnchor="end" fontSize="11.5" fill="var(--text-2)" className="hover:fill-[var(--cyan)]">
              {short(p.name)}
              <title>{p.name}</title>
            </text>
          </a>
        ))}
        {right.map((p, i) => (
          <a key={p.qid} href={`/pensador/${p.qid}`}>
            <text x={W - 176} y={ly(i, right.length) + 4} fontSize="11.5" fill="var(--text-2)" className="hover:fill-[var(--cyan)]">
              {short(p.name)}
              <title>{p.name}</title>
            </text>
          </a>
        ))}
        <text x={8} y={12} fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted)">
          INFLUENCIADO POR
        </text>
        <text x={W - 8} y={12} textAnchor="end" fontSize="9" fontFamily="var(--font-mono)" fill="var(--muted)">
          INFLUENCIOU
        </text>
      </svg>
    </div>
  );
}
