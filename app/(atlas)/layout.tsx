import { AtlasShell } from "@/components/shell/AtlasShell";
import { getEvents, getMapData, getStats } from "@/lib/queries";

/** The map stays mounted while the dossier beside it changes with the route. */
export default async function AtlasLayout({ children }: LayoutProps<"/">) {
  const [countries, stats, events] = await Promise.all([getMapData(), getStats(), getEvents(30)]);
  return (
    <AtlasShell countries={countries} stats={stats} events={events}>
      {children}
    </AtlasShell>
  );
}
