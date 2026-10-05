import { Suspense } from "react";
import { getDossier, getSources } from "@/lib/queries";
import { DossierHeader } from "./DossierHeader";
import { ElectionsSection } from "./ElectionsSection";
import { GovernmentContext } from "./GovernmentContext";
import { IdeologySection } from "./IdeologySection";
import { NobelSection } from "./NobelSection";
import { OpinionSection } from "./OpinionSection";
import { SourcesSection } from "./SourcesSection";
import { ThinkersSection } from "./ThinkersSection";

function SectionFallback({ label }: { label: string }) {
  return (
    <section className="px-4 py-4">
      <div className="label mb-2">{label}</div>
      <div className="h-16 animate-pulse bg-panel-2" />
    </section>
  );
}

export async function CountryDossier({ code }: { code: string }) {
  const [d, sources] = await Promise.all([getDossier(code), getSources()]);
  if (!d) return <div className="p-6 font-mono text-[12px] text-muted">País não encontrado: {code}</div>;
  return (
    <div className="divide-y divide-line">
      <DossierHeader d={d} />
      <Suspense fallback={<SectionFallback label="Governo em contexto" />}>
        <GovernmentContext code={code} />
      </Suspense>
      <IdeologySection d={d} />
      <Suspense fallback={<SectionFallback label="Eleições e deriva ideológica" />}>
        <ElectionsSection code={code} />
      </Suspense>
      <Suspense fallback={<SectionFallback label="Pensadores e intelectuais" />}>
        <ThinkersSection code={code} />
      </Suspense>
      <NobelSection entries={d.nobel} />
      <Suspense fallback={<SectionFallback label="Debate de opinião" />}>
        <OpinionSection code={code} />
      </Suspense>
      <SourcesSection ids={[...d.sourceIds, "wikipedia-elections", "wikipedia"]} sources={sources} d={d} />
    </div>
  );
}
