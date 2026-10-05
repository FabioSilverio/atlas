import { getCountryOpinion } from "@/lib/knowledge";
import { fmtDate } from "@/lib/ui/labels";

const TREND: Record<string, { mark: string; cls: string; label: string }> = {
  rising: { mark: "▲", cls: "text-cyan", label: "subindo" },
  new: { mark: "●", cls: "text-amber", label: "novo" },
  stable: { mark: "■", cls: "text-muted", label: "estável" },
  falling: { mark: "▼", cls: "text-muted", label: "caindo" },
};

export async function OpinionSection({ code }: { code: string }) {
  const o = await getCountryOpinion(code);
  if (!o.outlets.length)
    return (
      <section className="px-4 py-4">
        <h3 className="label mb-2">Debate de opinião</h3>
        <p className="text-[12.5px] text-muted">Nenhum veículo deste país é monitorado ainda. A lista fica em data/seed/outlets.json.</p>
      </section>
    );
  return (
    <>
      <section className="px-4 py-4">
        <h3 className="label mb-2">Ideias e teses em circulação</h3>
        {o.themes.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {o.themes.map((t) => (
              <li key={t.theme} className="border border-line-strong px-1.5 py-0.5 text-[12px] text-ink-2" title={`${t.recent} nos últimos 7 dias · ${t.previous} nas 3 semanas anteriores · ${TREND[t.trend]?.label}`}>
                <span className={`mr-1 font-mono text-[9px] ${TREND[t.trend]?.cls}`}>{TREND[t.trend]?.mark}</span>
                {t.theme}
                <span className="ml-1 font-mono text-[10px] text-muted">{t.recent}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted">Ainda sem volume suficiente para tendências (é preciso ~2 semanas de coleta).</p>
        )}
        {o.theses.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {o.theses.map((t, i) => (
              <li key={i} className="border-l-2 border-cyan-dim pl-2 text-[12.5px] leading-snug text-ink-2">
                {t.text}
                <span className="ml-1 font-mono text-[10px] text-muted">
                  {t.mentions}× · {fmtDate(t.lastSeen, { day: "2-digit", month: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] leading-snug text-muted">
          Temas: palavras-chave dos títulos e rótulos do modelo de IA local (Qwen, rodando no GitHub Actions); ▲ subindo = mais menções na última semana do que a média das 3 anteriores. Teses: frases extraídas pelo modelo, agrupadas quando se repetem.
        </p>
      </section>

      <section className="px-4 py-4">
        <h3 className="label mb-2">Colunistas e veículos</h3>
        <ul className="space-y-1">
          {o.outlets.map((v) => (
            <li key={v.id} className="flex items-baseline justify-between gap-2 text-[12.5px]">
              <a href={v.url} target="_blank" rel="noreferrer" className="truncate text-ink hover:text-cyan">
                {v.name}
                {v.kind === "politics" && <span className="ml-1 font-mono text-[9.5px] text-muted">(feed de política)</span>}
              </a>
              <span className="shrink-0 font-mono text-[10.5px] text-muted" title={v.alignment ? "Orientação política registrada no Wikidata (P1387)" : "Sem orientação registrada no Wikidata"}>
                {v.alignment ?? "orientação não registrada"} · {v.articles}
              </span>
            </li>
          ))}
        </ul>
        {o.columnists.length > 0 && (
          <>
            <div className="label mb-1 mt-3">Colunistas mais ativos (30 dias)</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
              {o.columnists.map((c) => (
                <span key={c.name + c.outlet}>
                  {c.name} <span className="font-mono text-[10px] text-muted">{c.articles}</span>
                </span>
              ))}
            </div>
          </>
        )}
        <div className="label mb-1 mt-3">Colunas recentes</div>
        <ul className="space-y-1.5">
          {o.articles.map((a) => (
            <li key={a.id} className="text-[12.5px] leading-snug">
              <a href={a.url} target="_blank" rel="noreferrer" className="text-ink hover:text-cyan">
                {a.title}
              </a>
              <div className="font-mono text-[10px] text-muted">
                {a.outlet}
                {a.author ? ` · ${a.author}` : ""} · {fmtDate(a.at, { day: "2-digit", month: "2-digit" })}
                {a.theme ? ` · ${a.theme}` : ""}
              </div>
              {a.summary && <p className="mt-0.5 text-[11.5px] text-ink-2">{a.summary}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] text-muted">Guardamos só título, autor, veículo, data e link (nunca o texto). Resumos são escritos pelo nosso modelo local.</p>
      </section>
    </>
  );
}
