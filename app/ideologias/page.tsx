import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/page/PageShell";
import { getIdeologies } from "@/lib/knowledge";

export const metadata: Metadata = { title: "Ideologias" };

export default async function IdeologiesPage() {
  const list = await getIdeologies();
  const inPower = list.filter((i) => i.inPower > 0);
  const rest = list.filter((i) => i.inPower === 0);
  return (
    <PageShell wide>
      <div className="label">Índice</div>
      <h1 className="mt-1 text-[28px] font-medium text-ink">Ideologias</h1>
      <p className="mt-2 max-w-2xl text-[14px] text-ink-2">
        Rótulos ideológicos declarados pelos partidos (Wikidata P1142) e movimentos associados aos pensadores do acervo. Ordenados por número de países onde
        estão no poder hoje.
      </p>
      <h2 className="label mt-8 border-b border-line pb-1.5">No poder ({inPower.length})</h2>
      <Grid items={inPower} />
      <h2 className="label mt-8 border-b border-line pb-1.5">Fora do poder / só no pensamento ({rest.length})</h2>
      <Grid items={rest} />
    </PageShell>
  );
}

function Grid({ items }: { items: Awaited<ReturnType<typeof getIdeologies>> }) {
  return (
    <ul className="mt-2 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <li key={i.qid}>
          <Link href={`/ideologia/${i.qid}`} className="block bg-panel-2 px-3 py-2 hover:bg-panel-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-[13.5px] text-ink">{i.name}</span>
              {i.inPower > 0 && <span className="shrink-0 font-mono text-[11px] text-cyan tabular">{i.inPower} países</span>}
            </div>
            <div className="mt-0.5 font-mono text-[10.5px] text-muted">
              {i.parties} partidos · {i.thinkers} pensadores
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
