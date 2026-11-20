"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore, useTransition, type ReactNode } from "react";
import type { FeedEvent, MapCountry, Stats } from "@/lib/queries";
import { LAYER_IDS, type LayerId } from "@/lib/ui/labels";
import { CountryList } from "./CountryList";
import { EventTicker } from "./EventTicker";
import { LayerPanel } from "./LayerPanel";
import { TopBar } from "./TopBar";

const AtlasMap = dynamic(() => import("@/components/map/AtlasMap"), { ssr: false });

type Props = {
  countries: MapCountry[];
  stats: Stats;
  events: FeedEvent[];
  children: ReactNode;
};

// The layer lives in the query string, read on the client (the pages are static).
const LAYER_EVENT = "atlas:layer";
const subscribeLayer = (cb: () => void) => {
  window.addEventListener("popstate", cb);
  window.addEventListener(LAYER_EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(LAYER_EVENT, cb);
  };
};
const readLayer = (): LayerId => {
  const l = new URLSearchParams(window.location.search).get("camada") as LayerId | null;
  return l && LAYER_IDS.includes(l) ? l : "pulse";
};

export function AtlasShell({ countries, stats, events, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const selected = pathname.match(/^\/pais\/([A-Z]{3})/)?.[1] ?? null;
  const layer = useSyncExternalStore(subscribeLayer, readLayer, () => "pulse" as LayerId);

  const qs = (l: LayerId) => (l !== "pulse" ? `?camada=${l}` : "");
  const go = useCallback(
    (next: { layer?: LayerId; country?: string | null }) => {
      const l = next.layer ?? layer;
      const c = next.country === undefined ? selected : next.country;
      const url = (c ? `/pais/${c}` : "/") + qs(l);
      if (c === selected) {
        window.history.replaceState(window.history.state, "", url);
        window.dispatchEvent(new Event(LAYER_EVENT));
      } else startTransition(() => router.push(url, { scroll: false }));
    },
    [layer, selected, router],
  );

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <TopBar stats={stats} countries={countries} onSelect={(code) => go({ country: code })} pending={pending} />

      <div className="relative min-h-0 flex-1">
        {/* Desktop: the map with floating panels */}
        <div className="absolute inset-0 hidden md:block">
          <AtlasMap countries={countries} layer={layer} selected={selected} onSelect={(code) => go({ country: code })} />
          <LayerPanel layer={layer} onLayer={(l) => go({ layer: l })} countries={countries} />
        </div>

        {/* Mobile without a selection: the list of countries */}
        {!selected && (
          <div className="h-full md:hidden">
            <CountryList countries={countries} />
          </div>
        )}

        {selected && (
          <aside
            className="scroll-thin dossier-in absolute inset-0 z-10 overflow-y-auto bg-panel md:inset-auto md:bottom-3 md:right-3 md:top-3 md:w-[460px] md:max-w-[calc(100%-1.5rem)] md:border md:border-line-strong md:bg-panel/[0.97] md:shadow-2xl md:backdrop-blur-sm"
            aria-label="Dossiê do país"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-2">
              <span className="label">Dossiê · {selected}</span>
              <div className="flex items-center gap-3">
                <Link href="/" className="font-mono text-[11px] text-ink-2 hover:text-cyan md:hidden">
                  ← países
                </Link>
                <button onClick={() => go({ country: null })} className="hidden font-mono text-[13px] text-ink-2 hover:text-cyan md:inline" aria-label="Fechar dossiê">
                  ✕
                </button>
              </div>
            </div>
            <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>{children}</div>
          </aside>
        )}
      </div>

      <EventTicker events={events} onCountry={(code) => go({ country: code })} />
    </div>
  );
}
