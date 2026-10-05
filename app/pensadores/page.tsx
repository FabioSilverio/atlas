import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/dossier/ThinkersSection";
import { PageShell } from "@/components/page/PageShell";
import { getTopThinkers } from "@/lib/knowledge";

export const metadata: Metadata = { title: "Pensadores" };

export default async function ThinkersIndex() {
  const list = await getTopThinkers(120);
  return (
    <PageShell wide>
      <div className="label">Índice</div>
      <h1 className="mt-1 text-[28px] font-medium text-ink">Pensadores</h1>
      <p className="mt-2 max-w-2xl text-[14px] text-ink-2">
        Os 120 intelectuais do acervo com maior presença na Wikipédia. Por país, use a camada “Densidade de pensadores” no mapa ou o dossiê. Busca por nome em{" "}
        <Link href="/busca" className="text-cyan">
          /busca
        </Link>
        .
      </p>
      <ul className="mt-6 grid gap-px sm:grid-cols-2 lg:grid-cols-3">
        {list.map((t) => (
          <li key={t.qid}>
            <Link href={`/pensador/${t.qid}`} className="flex items-center gap-2.5 bg-panel-2 px-2.5 py-2 hover:bg-panel-3">
              <Avatar t={t} size={36} />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] text-ink">{t.name}</span>
                <span className="block truncate text-[11.5px] text-muted">
                  {t.country} · {t.occupations.slice(0, 2).map((o) => o.label).join(", ")}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </PageShell>
  );
}
