import type { CountryIndicator } from "@/lib/pulse";

const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const dec = (n: number, d = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

type Spec = {
  key: string;
  label: string;
  format: (v: number) => string;
  /** 0–1 position on a bar where higher reads as "more" of the label; omitted = no bar. */
  bar?: (v: number) => number;
  hint: string;
};

const DEMOCRACY: Spec[] = [
  { key: "vdem_libdem", label: "Democracia liberal (V-Dem)", format: (v) => dec(v, 2), bar: (v) => v, hint: "0 = autocracia fechada, 1 = democracia liberal plena" },
  { key: "fh_total", label: "Liberdade (Freedom House)", format: (v) => `${int.format(v)}/100`, bar: (v) => v / 100, hint: "direitos políticos + liberdades civis" },
  { key: "vdem_freeexpr", label: "Liberdade de expressão (V-Dem)", format: (v) => dec(v, 2), bar: (v) => v, hint: "imprensa, debate e academia livres" },
  { key: "cpi", label: "Percepção de corrupção (TI)", format: (v) => `${int.format(v)}/100`, bar: (v) => v / 100, hint: "100 = muito íntegro, 0 = muito corrupto" },
];

const SOCIETY: Spec[] = [
  { key: "population", label: "População", format: (v) => compact.format(v), hint: "habitantes" },
  { key: "hdi", label: "IDH (PNUD)", format: (v) => dec(v, 3), bar: (v) => v, hint: "0 a 1" },
  { key: "life_expectancy", label: "Expectativa de vida", format: (v) => `${dec(v)} anos`, hint: "ao nascer" },
  { key: "gini", label: "Desigualdade (Gini)", format: (v) => dec(v), hint: "0 = igualdade total, 100 = máxima" },
  { key: "unemployment", label: "Desemprego", format: (v) => `${dec(v)}%`, hint: "estimativa OIT" },
  { key: "homicides", label: "Homicídios", format: (v) => `${dec(v)} por 100 mil`, hint: "intencionais" },
  { key: "military_spending", label: "Gasto militar", format: (v) => `${dec(v)}% do PIB`, hint: "SIPRI" },
];

/** Democracy, freedoms and society at a glance, each number with its year and source. */
export function IndicatorsSection({ indicators }: { indicators: CountryIndicator[] }) {
  const by = new Map(indicators.map((i) => [i.indicator, i]));
  const groups = [
    { title: "Democracia, liberdades e corrupção", specs: DEMOCRACY },
    { title: "Sociedade", specs: SOCIETY },
  ].map((g) => ({ ...g, specs: g.specs.filter((s) => by.has(s.key)) })).filter((g) => g.specs.length);
  if (!groups.length) return null;
  return (
    <section className="px-5 py-5">
      <div className="label">Indicadores do país</div>
      {groups.map((g) => (
        <div key={g.title} className="mt-3">
          <h3 className="mb-1.5 text-[12.5px] text-muted">{g.title}</h3>
          <dl className="grid grid-cols-2 gap-px bg-line font-mono text-[13px]">
            {g.specs.map((s) => {
              const i = by.get(s.key)!;
              return (
                <div key={s.key} className="min-w-0 bg-panel-2 px-3 py-2.5">
                  <dt className="text-[11.5px] text-muted">{s.label}</dt>
                  <dd className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="text-[14px] text-ink tabular">{s.format(i.value)}</span>
                    {i.sourceUrl ? (
                      <a href={i.sourceUrl} target="_blank" rel="noreferrer" className="text-[10.5px] text-muted underline decoration-line-strong underline-offset-2 hover:text-cyan" title={`${s.hint} · fonte`}>
                        {i.year}
                      </a>
                    ) : (
                      <span className="text-[10.5px] text-muted" title={s.hint}>{i.year}</span>
                    )}
                  </dd>
                  {s.bar && (
                    <div className="mt-1.5 h-1 bg-panel-3" title={s.hint}>
                      <div className="h-full bg-cyan-dim" style={{ width: `${Math.max(2, Math.min(100, s.bar(i.value) * 100))}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </dl>
        </div>
      ))}
      <p className="mt-2.5 text-[12px] text-muted">
        Banco Mundial (WDI); V-Dem, PNUD e Transparência Internacional via Our World in Data; Freedom House. O ano de cada dado leva à fonte.
      </p>
    </section>
  );
}
