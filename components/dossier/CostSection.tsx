import type { CountryCost } from "@/lib/pulse";

const usd = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Cost of living and average income (World Bank), in plain terms. */
export function CostSection({ cost }: { cost: CountryCost | null }) {
  if (!cost) return null;
  const pl = cost.priceLevel;
  return (
    <section className="px-4 py-4">
      <div className="label">Custo de vida e renda média</div>
      {pl != null && (
        <div className="mt-2.5">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-2">Nível de preços (EUA = 100)</span>
            <span className="font-mono text-[18px] text-ink tabular">{Math.round(pl)}</span>
          </div>
          <div className="relative mt-1.5 h-2 bg-panel-3">
            <span className="absolute inset-y-0 left-0 bg-cyan-dim" style={{ width: `${Math.min(100, (pl / 150) * 100)}%`, transition: "width 700ms cubic-bezier(.2,.8,.2,1)" }} />
            <span className="absolute inset-y-[-3px] w-px bg-ink-2" style={{ left: `${(100 / 150) * 100}%` }} title="EUA = 100" />
          </div>
          <p className="mt-1.5 text-[12px] text-muted">
            A mesma cesta de consumo que custa US$ 100 nos EUA custa cerca de <span className="text-ink">US$ {Math.round(pl)}</span> aqui
            {pl < 90 ? ", em dólares ao câmbio de mercado" : ""}.
          </p>
        </div>
      )}
      <dl className="mt-3 grid grid-cols-2 gap-px bg-line font-mono text-[11.5px]">
        <Cell k="Inflação ao consumidor" v={cost.inflation == null ? "—" : `${cost.inflation.toFixed(1)}% a.a.`} />
        <Cell k="Renda média mensal (PIB per capita ÷ 12)" v={cost.gdpPc == null ? "—" : usd.format(cost.gdpPc / 12)} />
        <Cell k="Mesma renda em poder de compra (PPC)" v={cost.gdpPcPpp == null ? "—" : `${usd.format(cost.gdpPcPpp / 12)} int.`} />
        <Cell k="Ano dos dados" v={cost.year ?? "—"} />
      </dl>
      <p className="mt-2 text-[11px] text-muted">
        Banco Mundial (WDI): paridade do consumo das famílias ÷ câmbio oficial; inflação (IPC); PIB per capita corrente e em PPC. Renda média por habitante, não salário típico.{" "}
        {cost.sources.price_level && (
          <a href={cost.sources.price_level} target="_blank" rel="noreferrer" className="text-ink-2 underline">
            dados ↗
          </a>
        )}
      </p>
    </section>
  );
}

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="bg-panel-2 px-2.5 py-2">
      <dt className="text-[10.5px] text-muted">{k}</dt>
      <dd className="mt-0.5 text-ink tabular">{v}</dd>
    </div>
  );
}
