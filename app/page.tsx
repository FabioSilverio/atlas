import { Suspense } from "react";
import { AtlasShell } from "@/components/shell/AtlasShell";
import { CountryDossier } from "@/components/dossier/CountryDossier";
import { DossierSkeleton } from "@/components/dossier/DossierSkeleton";
import { getEvents, getMapData, getStats } from "@/lib/queries";
import type { LayerId } from "@/lib/ui/labels";

const LAYER_IDS: LayerId[] = ["econ", "galtan", "nobel"];

export default async function Home({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const layer = LAYER_IDS.includes(sp.camada as LayerId) ? (sp.camada as LayerId) : "econ";
  const pais = typeof sp.pais === "string" ? sp.pais.toUpperCase().slice(0, 3) : null;
  const [countries, stats, events] = await Promise.all([getMapData(), getStats(), getEvents(30)]);
  const selected = pais && countries.some((c) => c.code === pais) ? pais : null;

  return (
    <AtlasShell
      countries={countries}
      stats={stats}
      events={events}
      layer={layer}
      selected={selected}
      dossier={
        selected ? (
          <Suspense key={selected} fallback={<DossierSkeleton />}>
            <CountryDossier code={selected} />
          </Suspense>
        ) : null
      }
    />
  );
}
