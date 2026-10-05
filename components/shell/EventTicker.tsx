"use client";

import type { FeedEvent } from "@/lib/queries";
import { EVENT_LABEL, fmtDate } from "@/lib/ui/labels";

export function EventTicker({ events, onCountry }: { events: FeedEvent[]; onCountry: (code: string) => void }) {
  const items = events.length ? events : null;
  return (
    <footer className="flex h-8 shrink-0 items-center border-t border-line bg-panel font-mono text-[11.5px]">
      <div className="flex h-full shrink-0 items-center gap-1.5 border-r border-line px-3 text-amber">
        <span className="live-dot inline-block size-1.5 rounded-full bg-amber" />
        <span className="tracking-widest">FEED</span>
      </div>
      {items ? (
        <div className="ticker relative min-w-0 flex-1 overflow-hidden">
          {/* Duplicated track so the loop is seamless. */}
          <div className="ticker-track flex w-max" style={{ ["--ticker-duration" as string]: `${Math.max(30, items.length * 8)}s` }}>
            {[0, 1].map((copy) =>
              items.map((e) => (
                <button
                  key={`${copy}-${e.id}`}
                  aria-hidden={copy === 1}
                  tabIndex={copy === 1 ? -1 : 0}
                  onClick={() => e.country && onCountry(e.country)}
                  className="flex shrink-0 items-center gap-2 px-4 text-ink-2 hover:text-ink"
                >
                  <span className="text-muted">{fmtDate(e.at, { day: "2-digit", month: "2-digit" })}</span>
                  <span className="border border-line-strong px-1 text-[10px] tracking-wider text-cyan">{EVENT_LABEL[e.type] ?? e.type.toUpperCase()}</span>
                  <span>{e.title}</span>
                </button>
              )),
            )}
          </div>
        </div>
      ) : (
        <span className="px-3 text-muted">Sem eventos novos desde a última ingestão.</span>
      )}
    </footer>
  );
}
