"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
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

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 380;
const WIDTH_KEY = "atlas:dossier-width";
const WIDTH_EVENT = "atlas:dossier-width";
const subscribeWidth = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(WIDTH_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(WIDTH_EVENT, cb);
  };
};
const readSavedWidth = (): number => {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= MIN_WIDTH) return Math.min(saved, window.innerWidth - 80);
  } catch {}
  return DEFAULT_WIDTH;
};
const writeSavedWidth = (next: number) => {
  try {
    localStorage.setItem(WIDTH_KEY, String(next));
    window.dispatchEvent(new Event(WIDTH_EVENT));
  } catch {}
};

export function AtlasShell({ countries, stats, events, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const selected = pathname.match(/^\/pais\/([A-Z]{3})/)?.[1] ?? null;
  const layer = useSyncExternalStore(subscribeLayer, readLayer, () => "pulse" as LayerId);
  const savedWidth = useSyncExternalStore(subscribeWidth, readSavedWidth, () => DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const width = dragWidth ?? savedWidth;
  const dragging = dragWidth !== null;
  const dragStart = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;
    let latest = dragStart.current?.w ?? DEFAULT_WIDTH;
    const onMove = (e: PointerEvent) => {
      if (!dragStart.current) return;
      const max = Math.max(MIN_WIDTH, Math.min(1100, window.innerWidth - 80));
      latest = Math.round(Math.max(MIN_WIDTH, Math.min(max, dragStart.current.w + (dragStart.current.x - e.clientX))));
      setDragWidth(latest);
    };
    const onUp = () => {
      writeSavedWidth(latest);
      setDragWidth(null);
      dragStart.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging]);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    dragStart.current = { x: e.clientX, w: width };
    setDragWidth(width);
  };

  const toggleWide = () => {
    const max = Math.min(920, window.innerWidth - 100);
    writeSavedWidth(width >= max - 60 ? DEFAULT_WIDTH : max);
  };

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
            style={{ "--dossier-w": `${width}px` } as React.CSSProperties}
            className="dossier-panel scroll-thin dossier-in absolute inset-0 z-10 overflow-y-auto bg-panel md:inset-auto md:bottom-3 md:right-3 md:top-3 md:w-[var(--dossier-w)] md:max-w-[calc(100%-1.5rem)] md:border md:border-line-strong md:bg-panel/[0.97] md:shadow-2xl md:backdrop-blur-sm"
            aria-label="Dossiê do país"
          >
            {/* Left-edge drag handle to resize the dossier sidebar horizontally */}
            <div
              onPointerDown={startResize}
              onDoubleClick={() => writeSavedWidth(DEFAULT_WIDTH)}
              title="Arraste para redimensionar o painel (duplo clique para restaurar)"
              role="separator"
              aria-orientation="vertical"
              aria-label="Redimensionar painel do dossiê"
              className={`group fixed z-20 hidden w-3 cursor-col-resize items-center justify-center md:flex ${dragging ? "bg-cyan/20" : "hover:bg-cyan/10"}`}
              style={{ top: 56, bottom: 40, right: `calc(min(${width}px, 100vw - 1.5rem) + 6px)` }}
            >
              <span className={`h-14 w-1 rounded-full transition-colors ${dragging ? "bg-cyan" : "bg-line-strong group-hover:bg-cyan"}`} />
            </div>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-2.5">
              <span className="label">Dossiê · {selected}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={toggleWide}
                  className="hidden font-mono text-[12px] text-ink-2 hover:text-cyan md:inline"
                  title={width > 680 ? "Voltar ao tamanho padrão" : "Ampliar painel"}
                  aria-label="Alternar largura do painel"
                >
                  {width > 680 ? "⇥" : "⇤"}
                </button>
                <Link href="/" className="font-mono text-[12px] text-ink-2 hover:text-cyan md:hidden">
                  ← países
                </Link>
                <button onClick={() => go({ country: null })} className="hidden font-mono text-[14px] text-ink-2 hover:text-cyan md:inline" aria-label="Fechar dossiê">
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
