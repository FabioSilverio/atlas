"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useTransition, type ReactNode } from "react";
import type { FeedEvent, MapCountry, Stats } from "@/lib/queries";
import type { LayerId } from "@/lib/ui/labels";
import { CountryList } from "./CountryList";
import { EventTicker } from "./EventTicker";
import { LayerPanel } from "./LayerPanel";
import { TopBar } from "./TopBar";

const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), { ssr: false });

type Props = {
  countries: MapCountry[];
  stats: Stats;
  events: FeedEvent[];
  layer: LayerId;
  selected: string | null;
  dossier: ReactNode;
};

export function AtlasShell({ countries, stats, events, layer, selected, dossier }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = useCallback(
    (next: { layer?: LayerId; country?: string | null }) => {
      const p = new URLSearchParams();
      const l = next.layer ?? layer;
      const c = next.country === undefined ? selected : next.country;
      if (l !== "econ") p.set("camada", l);
      if (c) p.set("pais", c);
      const qs = p.toString();
      startTransition(() => router.push(qs ? `/?${qs}` : "/", { scroll: false }));
    },
    [layer, selected, router],
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <TopBar stats={stats} countries={countries} onSelect={(code) => go({ country: code })} pending={pending} />

      {/* Desktop: map with floating panels */}
      <div className="relative hidden min-h-0 flex-1 md:block">
        <AtlasMap countries={countries} layer={layer} selected={selected} onSelect={(code) => go({ country: code })} />
        <LayerPanel layer={layer} onLayer={(l) => go({ layer: l })} countries={countries} />
        {selected && (
          <aside
            className="scroll-thin absolute bottom-3 right-3 top-3 z-10 w-[460px] max-w-[calc(100%-1.5rem)] overflow-y-auto border border-line-strong bg-panel/[0.97] shadow-2xl backdrop-blur-sm"
            aria-label="Dossiê do país"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-2">
              <span className="label">Dossiê · {selected}</span>
              <div className="flex items-center gap-3">
                <Link href={`/pais/${selected}`} className="font-mono text-[11px] text-ink-2 hover:text-cyan">
                  abrir página ↗
                </Link>
                <button onClick={() => go({ country: null })} className="font-mono text-[13px] text-ink-2 hover:text-cyan" aria-label="Fechar dossiê">
                  ✕
                </button>
              </div>
            </div>
            <div className={pending ? "opacity-60 transition-opacity" : ""}>{dossier}</div>
          </aside>
        )}
      </div>

      {/* Mobile: list of countries; the dossier opens as its own page */}
      <div className="min-h-0 flex-1 md:hidden">
        <CountryList countries={countries} />
      </div>

      <EventTicker events={events} onCountry={(code) => go({ country: code })} />
    </div>
  );
}
