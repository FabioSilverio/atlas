import { getDossier, getSources } from "@/lib/queries";
import { DossierHeader } from "./DossierHeader";
import { IdeologySection } from "./IdeologySection";
import { NobelSection } from "./NobelSection";
import { SourcesSection } from "./SourcesSection";

export async function CountryDossier({ code }: { code: string }) {
  const [d, sources] = await Promise.all([getDossier(code), getSources()]);
  if (!d) return <div className="p-6 font-mono text-[12px] text-muted">País não encontrado: {code}</div>;
  return (
    <div className="divide-y divide-line">
      <DossierHeader d={d} />
      <IdeologySection d={d} />
      <NobelSection entries={d.nobel} />
      <Upcoming />
      <SourcesSection ids={d.sourceIds} sources={sources} d={d} />
    </div>
  );
}

/** Sections from later phases, listed so the reader knows what the dossier will hold. */
function Upcoming() {
  const items = [
    ["Histórico eleitoral e deriva ideológica (20 anos)", 3],
    ["Pensadores e intelectuais influentes", 2],
    ["Colunistas e veículos de opinião", 4],
    ["Ideias e teses em circulação", 4],
    ["Conexões: pensadores estrangeiros mais citados", 2],
  ] as const;
  return (
    <section className="px-4 py-4">
      <h3 className="label mb-2">Próximas seções</h3>
      <ul className="space-y-1">
        {items.map(([t, p]) => (
          <li key={t} className="flex items-center justify-between text-[12.5px] text-muted">
            <span>{t}</span>
            <span className="font-mono text-[10.5px]">fase {p}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
