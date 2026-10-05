import type { Dossier, Source } from "@/lib/queries";
import { fmtDate } from "@/lib/ui/labels";

export function SourcesSection({ ids, sources, d }: { ids: string[]; sources: Source[]; d: Dossier }) {
  const used = sources.filter((s) => ids.includes(s.id));
  return (
    <section className="px-4 py-4">
      <h3 className="label mb-2">Fontes deste dossiê</h3>
      <ul className="space-y-2">
        {used.map((s) => (
          <li key={s.id} className="text-[12px] leading-snug">
            <a href={s.url} target={s.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="text-ink hover:text-cyan">
              {s.name}
            </a>
            <div className="font-mono text-[10.5px] text-muted">
              {[s.version, s.license, s.retrievedAt ? `coletado ${fmtDate(s.retrievedAt)}` : null].filter(Boolean).join(" · ")}
            </div>
          </li>
        ))}
      </ul>
      {d.government && (
        <p className="mt-3 font-mono text-[10.5px] text-muted">
          Governo verificado em {fmtDate(d.government.verifiedAt)}
          {d.government.sourceUrl?.startsWith("http") && (
            <>
              {" · "}
              <a href={d.government.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-line-strong hover:text-cyan">
                registro de origem
              </a>
            </>
          )}
          {d.government.sourceId === "atlas-curation" && " (correção editorial)"}
        </p>
      )}
      <p className="mt-1 font-mono text-[10.5px] text-muted">
        País atualizado em {fmtDate(d.updatedAt)} ·{" "}
        <a href="/metodologia" className="underline decoration-line-strong hover:text-cyan">
          metodologia
        </a>
      </p>
    </section>
  );
}
