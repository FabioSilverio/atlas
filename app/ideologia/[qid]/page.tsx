import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/dossier/ThinkersSection";
import { PageShell, Section } from "@/components/page/PageShell";
import { getIdeology } from "@/lib/knowledge";
import { fmtNorm } from "@/lib/ui/labels";
import { css, divergingColor } from "@/lib/ui/palette";

export async function generateMetadata({ params }: PageProps<"/ideologia/[qid]">): Promise<Metadata> {
  const i = await getIdeology((await params).qid);
  return { title: i ? i.name : "Ideologia não encontrada", description: i?.description ?? undefined };
}

export default async function IdeologyPage({ params }: PageProps<"/ideologia/[qid]">) {
  const { qid } = await params;
  const i = await getIdeology(qid);
  if (!i) notFound();
  const maxT = Math.max(1, ...i.timeline.map((t) => t.countries));
  return (
    <PageShell back={{ href: "/ideologias", label: "← ideologias" }}>
      <div className="label">Ideologia</div>
      <h1 className="mt-1 text-[28px] font-medium leading-tight text-ink">{i.name}</h1>
      {i.nameEn && i.nameEn.toLowerCase() !== i.name.toLowerCase() && <div className="font-mono text-[12px] text-muted">{i.nameEn}</div>}
      {i.description && <p className="mt-2 text-[14px] text-ink-2">{i.description}</p>}

      {i.summary && (
        <Section title="Definição">
          <p className="text-[15px] leading-relaxed text-ink-2">{i.summary}</p>
          <p className="mt-1 font-mono text-[10.5px] text-muted">
            Trecho da{" "}
            <a href={i.summaryUrl ?? "#"} target="_blank" rel="noreferrer" className="underline">
              Wikipédia
            </a>{" "}
            (CC BY-SA 4.0).
          </p>
        </Section>
      )}

      <Section title="No poder hoje" aside={<span className="font-mono text-[10.5px] text-muted">partido do chefe do executivo declara esta ideologia (Wikidata P1142)</span>}>
        {i.inPower.length ? (
          <ul className="space-y-px">
            {i.inPower.map((c) => (
              <li key={c.code}>
                <Link href={`/?pais=${c.code}`} className="grid grid-cols-[1fr_auto] items-center gap-3 bg-panel-2 px-3 py-1.5 hover:bg-panel-3">
                  <span className="min-w-0">
                    <span className="text-[13.5px] text-ink">{c.country}</span>
                    <span className="ml-2 truncate text-[12px] text-muted">
                      {c.leader} · {c.party}
                    </span>
                  </span>
                  {c.econ != null && (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-2">
                      <span className="inline-block size-2.5" style={{ background: css(divergingColor(c.econ)) }} />
                      {fmtNorm(c.econ)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nenhum governo atual é chefiado por um partido que declare esta ideologia.</p>
        )}
      </Section>

      {i.timeline.length > 1 && (
        <Section title="Linha do tempo de adoção" aside={<span className="font-mono text-[10.5px] text-muted">países com chefe do executivo de partido desta ideologia</span>}>
          <div className="flex h-28 items-end gap-1">
            {i.timeline.map((t) => (
              <div key={t.year} className="flex flex-1 flex-col items-center gap-1" title={`${t.year}: ${t.countries} países`}>
                <span className="font-mono text-[9.5px] text-ink-2 tabular">{t.countries}</span>
                <div className="w-full bg-[#3987e5]" style={{ height: `${(t.countries / maxT) * 80}px`, minHeight: 2 }} />
                <span className="font-mono text-[9px] text-muted">{String(t.year).slice(2)}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">Conta só partidos monitorados pelo ATLAS (os que governam hoje); 2006–2020 via Herre (2023), ano atual via snapshot diário.</p>
        </Section>
      )}

      <Section title="Pensadores associados" aside={<span className="font-mono text-[10.5px] text-muted">Wikidata P135 / P1142</span>}>
        {i.thinkers.length ? (
          <ul className="grid gap-px sm:grid-cols-2">
            {i.thinkers.map((t) => (
              <li key={t.qid}>
                <Link href={`/pensador/${t.qid}`} className="flex items-center gap-2.5 bg-panel-2 px-2.5 py-1.5 hover:bg-panel-3">
                  <Avatar t={t} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-ink">{t.name}</span>
                    <span className="block truncate font-mono text-[10.5px] text-muted">{t.country}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">Nenhum pensador do acervo associado.</p>
        )}
      </Section>

      {i.parties.length > 0 && (
        <Section title="Partidos monitorados">
          <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {i.parties.map((p, n) => (
              <li key={n} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="truncate text-ink-2">
                  {p.party} <span className="font-mono text-[10.5px] text-muted">{p.code}</span>
                </span>
                {p.econ != null && <span className="font-mono text-[11px] text-muted">{fmtNorm(p.econ)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="mt-10 font-mono text-[10.5px] text-muted">
        Fonte:{" "}
        <a href={`https://www.wikidata.org/wiki/${i.qid}`} target="_blank" rel="noreferrer" className="underline">
          Wikidata {i.qid}
        </a>
        . A ideologia declarada de um partido é um rótulo; a posição numérica vem das bases acadêmicas.
      </p>
    </PageShell>
  );
}
