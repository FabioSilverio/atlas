import Link from "next/link";
import { getCountryThinkers, type ThinkerCard } from "@/lib/knowledge";

const years = (t: ThinkerCard) => (t.birthYear ? `${t.birthYear < 0 ? `${-t.birthYear} a.C.` : t.birthYear}–${t.deathYear ?? ""}` : "");

export async function ThinkersSection({ code }: { code: string }) {
  const { total, thinkers, foreign } = await getCountryThinkers(code);
  return (
    <>
      <section className="px-4 py-4">
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="label">Pensadores e intelectuais</h3>
          <span className="font-mono text-[10.5px] text-muted">{total} no acervo</span>
        </div>
        {thinkers.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nenhum pensador deste território passa o corte de notabilidade (número de edições da Wikipédia).</p>
        ) : (
          <ul className="space-y-px">
            {thinkers.map((t) => (
              <li key={t.qid}>
                <Link href={`/pensador/${t.qid}`} className="flex items-center gap-2.5 bg-panel-2 px-2.5 py-1.5 hover:bg-panel-3">
                  <Avatar t={t} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[13px] text-ink">{t.name}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-muted">{years(t)}</span>
                    </div>
                    <div className="truncate text-[11.5px] text-muted">{t.fields.slice(0, 3).map((f) => f.label).join(" · ") || t.description}</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] text-muted">Ordenados por presença na Wikipédia (número de idiomas), um indicador de notabilidade, não de importância intelectual.</p>
      </section>

      <section className="px-4 py-4">
        <h3 className="label mb-2">Conexões: influências estrangeiras</h3>
        {foreign.length === 0 ? (
          <p className="text-[12.5px] text-muted">Sem relações de influência registradas no Wikidata para os pensadores deste país.</p>
        ) : (
          <>
            <p className="mb-2 text-[11.5px] leading-snug text-muted">Pensadores de outros países que mais aparecem como influência dos pensadores daqui (Wikidata P737).</p>
            <ol className="space-y-1">
              {foreign.map((t) => (
                <li key={t.qid} className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-right font-mono text-[11px] text-cyan tabular">{t.cites}×</span>
                  <Link href={`/pensador/${t.qid}`} className="truncate text-[13px] text-ink hover:text-cyan">
                    {t.name}
                  </Link>
                  <span className="ml-auto shrink-0 font-mono text-[10.5px] text-muted">{t.country}</span>
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </>
  );
}

export function Avatar({ t, size = 32 }: { t: { name: string; imageUrl: string | null }; size?: number }) {
  return t.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={t.imageUrl} alt="" width={size} height={size} loading="lazy" className="shrink-0 bg-panel-3 object-cover grayscale" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center bg-panel-3 font-mono text-[11px] text-muted" style={{ width: size, height: size }}>
      {t.name
        .split(" ")
        .map((w) => w[0])
        .slice(0, 2)
        .join("")}
    </span>
  );
}
