"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PulseItem, PulseSide } from "@/lib/db/schema";
import type { CountryPulse } from "@/lib/pulse";
import { SideBar, leader } from "@/components/ui/SideBar";
import { css, divergingColor } from "@/lib/ui/palette";

const POLL_MS = 5 * 60_000;
const PLATFORM: Record<string, string> = { news: "Manchetes", x: "Tendências do X", reddit: "Reddit", youtube: "YouTube", "x-voice": "Vozes no X" };
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const fmtN = (n: number | null | undefined) => (n == null ? "—" : compact.format(n));

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

const sideColor = (econ: number | null) => (econ == null ? undefined : css(divergingColor(Math.max(-1, Math.min(1, econ / 0.5)))));

/**
 * "Agora": what each country's political conversation is about right now and
 * which side it mentions most. Prebuilt with the page, then refreshed from
 * /data/pulse/<code>.json every few minutes while the tab is open.
 */
export function PulseSection({ code, initial }: { code: string; initial: CountryPulse | null }) {
  const [p, setP] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState<string | null>(null);
  const [allVideos, setAllVideos] = useState(false);
  const [allVoices, setAllVoices] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      setNow(Date.now());
      if (document.hidden) return;
      try {
        const next = (await (await fetch(`/data/pulse/${code}.json`, { cache: "no-store" })).json()) as CountryPulse | null;
        if (alive && next && next.computedAt !== p?.computedAt) setP(next);
      } catch {}
    };
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [code, p?.computedAt]);

  if (!p) {
    return (
      <section className="px-4 py-4">
        <Header />
        <p className="mt-2 text-[13px] text-muted">O monitor ainda não coletou nada sobre este país. Ele roda de hora em hora.</p>
      </section>
    );
  }
  const d = p.data;
  const lead = leader(d.overall.left, d.overall.right);
  const shift = d.previous?.mean != null && d.overall.mean != null ? d.overall.mean - d.previous.mean : null;
  const openTerm = d.terms.find((t) => t.term === open);

  return (
    <section className="px-5 py-5">
      <Header updated={ago(p.computedAt, now)} />

      {/* Thermometer */}
      {d.overall.n > 0 ? (
        <div className="mt-3.5 border border-line bg-panel-2 p-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <div className="text-[17px] font-medium" style={{ color: lead.side === "tie" ? undefined : sideColor(lead.side === "right" ? 0.6 : -0.6) }}>
              {lead.text[0].toUpperCase() + lead.text.slice(1)}
            </div>
            {shift != null && Math.abs(shift) >= 0.02 && (
              <div className="shrink-0 font-mono text-[12px]" style={{ color: sideColor(shift * 5) }} title="Média de posição das últimas 72 h comparada aos 7 dias anteriores">
                {shift > 0 ? "→ direita" : "← esquerda"} vs semana anterior
              </div>
            )}
          </div>
          <div className="mt-1 text-[13.5px] text-muted">Quem domina a conversa política nas últimas 72 h ({d.overall.n} itens que citam partidos ou políticos)</div>
          <div className="mt-3">
            <SideBar left={d.overall.left} center={d.overall.center} right={d.overall.right} height={14} />
          </div>
          <div className="mt-3.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2">
            {Object.entries(d.byPlatform).map(([k, s]) => (
              <PlatformRow key={k} label={PLATFORM[k] ?? k} s={s} />
            ))}
            {d.youtubeChannels && <PlatformRow label="Views: canais de partidos/políticos" s={d.youtubeChannels} />}
          </div>
          {p.history.length >= 3 && <Trend history={p.history} />}
          <p className="mt-3 text-[12px] leading-snug text-muted">
            Estimativa. Cada item conta para o lado de quem ele cita, pela posição acadêmica do partido (CHES, ParlGov, GPS…); vídeos e posts pesam pelas visualizações e votos. Ser citado não é
            ser apoiado. <Link href="/metodologia#pulso" className="text-ink-2 underline">Como medimos</Link>
          </p>
        </div>
      ) : (
        <p className="mt-2.5 text-[13.5px] text-muted">Ainda não há itens que citem partidos ou políticos com posição conhecida para medir os lados.</p>
      )}

      {/* Terms */}
      {d.terms.length > 0 && (
        <div className="mt-5">
          <div className="label mb-2">Termos mais falados agora</div>
          <div className="flex flex-wrap gap-2">
            {d.terms.map((t) => {
              const rising = t.count >= 2 * (t.previous / 3 + 1);
              const on = open === t.term;
              return (
                <button
                  key={t.term}
                  onClick={() => setOpen(on ? null : t.term)}
                  className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-[13.5px] transition-colors ${on ? "border-cyan bg-panel-3 text-ink" : "border-line-strong text-ink-2 hover:border-cyan-dim hover:text-ink"}`}
                  aria-expanded={on}
                >
                  {t.econ != null && <span className="inline-block size-2 rounded-full" style={{ background: sideColor(t.econ) }} />}
                  <span>{t.term}</span>
                  <span className="font-mono text-[11.5px] text-muted">{t.count}</span>
                  {rising && <span className="font-mono text-[11px] text-amber">▲</span>}
                </button>
              );
            })}
          </div>
          {openTerm && (
            <div className="term-in mt-3 border-l-2 border-cyan-dim pl-3.5">
              <div className="font-mono text-[12px] text-muted">
                {Object.entries(openTerm.platforms).map(([k, n]) => `${PLATFORM[k] ?? k}: ${n}`).join(" · ")} · nos 3 dias anteriores: {openTerm.previous}
              </div>
              <ul className="mt-2 space-y-2.5">
                {openTerm.items.map((it) => (it.platform === "youtube" ? <Video key={it.url} v={it} now={now} /> : <Headline key={it.url} h={it} now={now} />))}
              </ul>
              <a href={`https://www.youtube.com/results?search_query=${encodeURIComponent(openTerm.term)}&sp=CAMSAhAB`} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[12px] text-cyan hover:underline">
                mais vídeos sobre “{openTerm.term}” no YouTube ↗
              </a>
            </div>
          )}
        </div>
      )}

      {/* Most-viewed videos */}
      {d.videos.length > 0 && (
        <div className="mt-6">
          <div className="label mb-2">Vídeos políticos mais vistos ({d.videos.length})</div>
          <ul className="space-y-3">
            {(allVideos ? d.videos : d.videos.slice(0, 12)).map((v) => (
              <Video key={v.url} v={v} now={now} />
            ))}
          </ul>
          {d.videos.length > 12 && (
            <button onClick={() => setAllVideos((v) => !v)} className="mt-2.5 font-mono text-[12px] text-cyan hover:underline">
              {allVideos ? "mostrar menos vídeos" : `ver mais ${d.videos.length - 12} vídeos ▾`}
            </button>
          )}
        </div>
      )}

      {/* X */}
      {(d.xTrends.length > 0 || (d.voices?.length ?? 0) > 0) && (
        <div className="mt-6 grid gap-5">
          {d.xTrends.length > 0 && (
            <div>
              <div className="label mb-2">Em alta no X agora</div>
              <ol className="grid grid-cols-2 gap-x-4 gap-y-1">
                {d.xTrends.slice(0, 16).map((t, i) => (
                  <li key={t.term} className="flex min-w-0 items-baseline gap-2 text-[14px]">
                    <span className="w-5 shrink-0 text-right font-mono text-[11.5px] text-muted">{i + 1}</span>
                    <a href={t.url} target="_blank" rel="noreferrer" className={`truncate hover:text-cyan ${t.political ? "text-ink" : "text-ink-2"}`} title={t.political ? "cita um partido ou político" : undefined}>
                      {t.term}
                    </a>
                    {t.political && <span className="size-1.5 shrink-0 rounded-full bg-amber" />}
                    {t.volume != null && <span className="ml-auto shrink-0 font-mono text-[11.5px] text-muted">{fmtN(t.volume)}</span>}
                  </li>
                ))}
              </ol>
              <div className="mt-1.5 font-mono text-[11.5px] text-muted">
                fonte: <a href="https://trends24.in" target="_blank" rel="noreferrer" className="underline">trends24.in</a> · ponto âmbar = cita partido ou político
              </div>
            </div>
          )}
          {(d.voices?.length ?? 0) > 0 && (
            <div>
              <div className="label mb-2">Vozes no X — posts mais engajados ({d.voices.length})</div>
              <ul className="space-y-2">
                {(allVoices ? d.voices : d.voices.slice(0, 8)).map((v) => (
                  <li key={v.url} className="border border-line bg-panel-2 px-3 py-2">
                    <div className="font-mono text-[12px] text-ink-2">{v.author}</div>
                    <a href={v.url} target="_blank" rel="noreferrer" className="mt-1 line-clamp-3 block text-[14px] leading-snug text-ink hover:text-cyan">
                      {v.title}
                    </a>
                    <div className="mt-1 font-mono text-[11.5px] text-muted">
                      {fmtN(v.metric)} interações · {ago(v.publishedAt, now)}
                    </div>
                  </li>
                ))}
              </ul>
              {d.voices.length > 8 && (
                <button onClick={() => setAllVoices((v) => !v)} className="mt-2 font-mono text-[12px] text-cyan hover:underline">
                  {allVoices ? "mostrar menos posts" : `ver mais ${d.voices.length - 8} posts ▾`}
                </button>
              )}
              <div className="mt-1.5 font-mono text-[11.5px] text-muted">lista de vozes por curadoria do editor; posts via FxTwitter</div>
            </div>
          )}
        </div>
      )}

      {/* Reddit */}
      {d.reddit.length > 0 && (
        <div className="mt-6">
          <div className="label mb-2">Reddit — mais votados hoje</div>
          <ul className="space-y-1.5">
            {d.reddit.slice(0, 8).map((r) => (
              <li key={r.url} className="flex items-baseline gap-2.5 text-[14px] leading-snug">
                <span className="w-12 shrink-0 text-right font-mono text-[11.5px] text-muted">▲{fmtN(r.metric)}</span>
                <a href={r.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-ink-2 hover:text-cyan">
                  {r.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Headlines */}
      {d.headlines.length > 0 && (
        <div className="mt-6">
          <div className="label mb-2">Manchetes nacionais</div>
          <ul className="space-y-2.5">
            {d.headlines.slice(0, 8).map((h) => (
              <Headline key={h.url} h={h} now={now} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-5 font-mono text-[11.5px] text-muted">
        monitorado em 72 h: {Object.entries(d.counts).map(([k, n]) => `${PLATFORM[k] ?? k} ${fmtN(n)}`).join(" · ")}
      </div>
    </section>
  );
}

function Header({ updated }: { updated?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="label flex items-center gap-1.5">
        <span className="live-dot inline-block size-2 rounded-full bg-amber" /> Agora · pulso político
      </div>
      {updated && <span className="font-mono text-[11.5px] text-muted">atualizado {updated}</span>}
    </div>
  );
}

function PlatformRow({ label, s }: { label: string; s: PulseSide }) {
  return (
    <>
      <span className="truncate text-[13px] text-ink-2">{label}</span>
      <SideBar left={s.left} center={s.center} right={s.right} height={6} labels={false} />
      <span className="font-mono text-[11.5px] text-muted tabular">{s.n}</span>
    </>
  );
}

function Video({ v, now }: { v: PulseItem; now: number }) {
  return (
    <li>
      <a href={v.url} target="_blank" rel="noreferrer" className="group flex gap-3">
        {v.videoId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" loading="lazy" className="h-[66px] w-[118px] shrink-0 bg-panel-3 object-cover transition-opacity group-hover:opacity-80" />
        )}
        <span className="min-w-0">
          <span className="line-clamp-2 text-[14px] leading-snug text-ink group-hover:text-cyan">{v.title}</span>
          <span className="mt-1 flex items-center gap-1.5 font-mono text-[11.5px] text-muted">
            {v.econ != null && <span className="inline-block size-2 rounded-full" style={{ background: sideColor(v.econ) }} />}
            <span className="truncate">{v.author}</span> · {fmtN(v.metric)} views · {ago(v.publishedAt, now)}
          </span>
        </span>
      </a>
    </li>
  );
}

function Headline({ h, now }: { h: PulseItem; now: number }) {
  return (
    <li className="text-[14px] leading-snug">
      <a href={h.url} target="_blank" rel="noreferrer" className="line-clamp-2 text-ink-2 hover:text-cyan">
        {h.econ != null && <span className="mr-1.5 inline-block size-2 rounded-full align-middle" style={{ background: sideColor(h.econ) }} />}
        {h.title}
      </a>
      <span className="font-mono text-[11.5px] text-muted">
        {h.author} · {ago(h.publishedAt, now)}
      </span>
    </li>
  );
}

/** Daily mean position of the conversation, last weeks (0 = centre line). */
function Trend({ history }: { history: CountryPulse["history"] }) {
  const pts = useMemo(() => history.filter((h) => h.mean != null), [history]);
  if (pts.length < 3) return null;
  const W = 300;
  const Hh = 36;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (m: number) => Hh / 2 - Math.max(-1, Math.min(1, m / 0.5)) * (Hh / 2 - 2);
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.mean!).toFixed(1)}`).join(" ");
  return (
    <div className="mt-3">
      <div className="flex justify-between font-mono text-[10px] text-muted">
        <span>tendência diária ({pts.length} dias)</span>
        <span>↑ direita · ↓ esquerda</span>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="mt-1 h-9 w-full" preserveAspectRatio="none" aria-hidden>
        <line x1="0" x2={W} y1={Hh / 2} y2={Hh / 2} stroke="currentColor" className="text-line-strong" strokeDasharray="2 3" strokeWidth="1" />
        <path d={path} fill="none" stroke="currentColor" className="text-cyan" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
