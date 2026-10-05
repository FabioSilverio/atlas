import type { Metadata } from "next";
import Link from "next/link";
import overrides from "@/data/seed/overrides/governments.json";
import crosswalk from "@/data/seed/party-crosswalk.json";
import { SOURCE_PRIORITY, SOURCE_SHORT } from "@/lib/ideology/derive";
import { getSources } from "@/lib/queries";
import { fmtDate } from "@/lib/ui/labels";
import { CONFIDENCE_TEXT, DIVERGING_STOPS } from "@/lib/ui/palette";

export const metadata: Metadata = { title: "Metodologia" };

export default async function Metodologia() {
  const sources = await getSources();
  const ov = Object.entries(overrides).filter(([k]) => !k.startsWith("_")) as [string, { chief_executive_role?: string; justification: string; source_url: string; verified_at: string }][];
  const cw = Object.entries(crosswalk).filter(([k]) => !k.startsWith("_")) as [string, { note: string }][];
  const gradient = `linear-gradient(90deg, ${DIVERGING_STOPS.map(([v, h]) => `${h} ${((v + 1) / 2) * 100}%`).join(", ")})`;

  return (
    <div className="scroll-thin h-dvh overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex h-12 items-center justify-between border-b border-line bg-panel px-4">
        <Link href="/" className="font-mono text-[13px] tracking-[0.3em] text-ink">
          ATLAS
        </Link>
        <Link href="/" className="font-mono text-[11px] text-ink-2 hover:text-cyan">
          ← mapa
        </Link>
      </header>
      <main className="mx-auto max-w-3xl space-y-10 px-5 py-10 text-[15px] leading-relaxed text-ink-2">
        <div>
          <div className="label">Metodologia</div>
          <h1 className="mt-1 text-[28px] font-medium leading-tight text-ink">Como o ATLAS classifica governos</h1>
          <p className="mt-3">
            Nenhuma posição ideológica deste painel é atribuída por modelo de linguagem ou por opinião da redação. Cada número vem de uma base acadêmica citada, e o
            caminho do dado bruto até a cor do mapa fica visível no dossiê de cada país.
          </p>
        </div>

        <Section n="1" title="Quem governa">
          <p>
            Chefes de Estado e de governo vêm do Wikidata (propriedades P35 e P6, só mandatos sem data de término). O partido vem das filiações em aberto (P102),
            descartando partidos de nível europeu (como o PPE) e os itens “político sem partido” e “apartidarismo”. Quando há mais de uma filiação aberta, vale a de
            início mais recente, porque o Wikidata costuma deixar filiações antigas sem data de término.
          </p>
          <p>
            O <strong className="text-ink">chefe do executivo</strong>, cuja posição conta como a do governo, segue esta ordem: (1) correção editorial documentada; (2) se
            chefe de Estado e de governo são a mesma pessoa, é ela; (3) se só um está registrado, é ele; (4) se Herre (2023), a partir do V-Dem, registra o chefe de
            governo do país com o título de presidente, o sistema é presidencialista e vale o presidente atual; (5) a codificação de Herre sobre quem era o líder efetivo
            no ano mais recente; (6) na falta de tudo isso, o chefe de governo.
          </p>
        </Section>

        <Section n="2" title="Hierarquia de fontes, sem médias">
          <p>
            Escalas de instrumentos diferentes não são comparáveis o bastante para serem misturadas. Para cada eixo usamos <strong className="text-ink">a primeira fonte
            disponível</strong> nesta ordem; as demais aparecem no dossiê como referência:
          </p>
          <ol className="ml-5 list-decimal space-y-0.5 font-mono text-[13px]">
            {SOURCE_PRIORITY.map((s) => (
              <li key={s}>{SOURCE_SHORT[s] ?? s}</li>
            ))}
          </ol>
          <p>
            Os partidos são ligados às bases pelo <strong className="text-ink">Party Facts</strong>, que mapeia os identificadores de todas elas. Quando o Party Facts
            ainda não conhece um partido, há um crosswalk manual com justificativa ({cw.length} entradas, listadas abaixo).
          </p>
          <p>
            Todas as escalas de 0 a 10 são normalizadas para −1 a +1. Eixo econômico: CHES <code>lrecon</code>, ParlGov <code>state_market</code>, GPS <code>V4</code>.
            Eixo cultural (GAL–TAN, de libertário/progressista a autoritário/tradicionalista): CHES <code>galtan</code>, ParlGov <code>liberty_authority</code>, GPS{" "}
            <code>V6</code>. Herre (2023) classifica líderes como esquerda, centro ou direita; essas categorias são posicionadas em −0,6, 0 e +0,6 por convenção visual.
          </p>
          <div>
            <div className="h-2.5 w-full max-w-md" style={{ background: gradient }} />
            <div className="mt-1 flex max-w-md justify-between font-mono text-[11px] text-muted">
              <span>−1 esquerda</span>
              <span>0</span>
              <span>+1 direita</span>
            </div>
            <p className="mt-2 text-[13px] text-muted">
              Violeta ↔ cobre em vez de vermelho ↔ azul, porque vermelho significa esquerda no Brasil e direita nos EUA. Os dois polos foram validados para daltonismo.
            </p>
          </div>
        </Section>

        <Section n="3" title="Níveis de confiança">
          <dl className="space-y-2">
            {(["A", "B", "C", "D"] as const).map((c) => (
              <div key={c} className="flex gap-3">
                <dt className="w-6 shrink-0 font-mono text-ink">{c}</dt>
                <dd>{CONFIDENCE_TEXT[c].long}</dd>
              </div>
            ))}
          </dl>
          <p>
            No mapa, a confiança vira opacidade, e estimativas (D) e países sem dado recebem hachura. A estimativa D tem um único critério automático: o
            partido não tem survey, mas um líder anterior do mesmo partido foi codificado por Herre (2023).
          </p>
        </Section>

        <Section n="4" title="Limites conhecidos (Fase 1)">
          <ul className="ml-5 list-disc space-y-1">
            <li>Usa só o partido do chefe do executivo. A ponderação por cadeiras dos parceiros de coalizão chega na Fase 3, com os dados de composição parlamentar.</li>
            <li>
              Surveys têm defasagem: o Global Party Survey é de 2019 e o CHES-LA de 2020. Partidos criados depois disso ficam sem dado até a próxima onda, e é por isso que
              países como a Argentina de Milei aparecem sem classificação.
            </li>
            <li>Monarcas absolutos, juntas militares e chefes de executivo independentes geralmente não têm medição acadêmica e aparecem como “sem dado”.</li>
            <li>O Wikidata pode demorar a refletir trocas de governo; cada dossiê mostra a data de verificação e o link do registro.</li>
            <li>A próxima eleição vem do calendário de curto prazo do ElectionGuide (IFES); eleições mais distantes chegam na Fase 3.</li>
          </ul>
        </Section>

        <Section n="5" title="Nobel">
          <p>
            Dados da API oficial (nobelprize.org v2.1). Atribuição padrão por país de nascimento, em fronteiras atuais (organizações: país da sede), com a alternativa de
            afiliação institucional na época do prêmio. Em outubro, a coleta roda a cada 6 horas para acompanhar os anúncios.
          </p>
        </Section>

        <Section n="6" title="Correções editoriais">
          <p>Cada correção sobre os dados automáticos exige justificativa, fonte e data de verificação.</p>
          <ul className="space-y-2 text-[13.5px]">
            {ov.map(([code, o]) => (
              <li key={code} className="border-l-2 border-line-strong pl-3">
                <Link href={`/pais/${code}`} className="font-mono text-ink hover:text-cyan">
                  {code}
                </Link>{" "}
                {o.justification}{" "}
                <a href={o.source_url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-muted underline">
                  fonte
                </a>{" "}
                <span className="font-mono text-[11px] text-muted">· {o.verified_at}</span>
              </li>
            ))}
          </ul>
          <div className="label mt-4">Crosswalk de partidos</div>
          <ul className="space-y-1 text-[13.5px]">
            {cw.map(([qid, c]) => (
              <li key={qid}>
                <a href={`https://www.wikidata.org/wiki/${qid}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-ink hover:text-cyan">
                  {qid}
                </a>{" "}
                {c.note}
              </li>
            ))}
          </ul>
        </Section>

        <Section n="7" title="Fontes">
          <ul className="space-y-3">
            {sources.map((s) => (
              <li key={s.id} className="text-[13.5px]">
                <a href={s.url} target={s.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="text-ink hover:text-cyan">
                  {s.name}
                </a>
                <div className="text-muted">{s.citation}</div>
                <div className="font-mono text-[11px] text-muted">
                  {[s.version, s.license, s.retrievedAt ? `coletado em ${fmtDate(s.retrievedAt)}` : "ainda não coletado"].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
          <p className="text-[13.5px]">
            Direitos autorais: o ATLAS não armazena texto integral de terceiros. Os dados brutos ficam em cache local só para reprocessamento; o que é publicado são
            identificadores, posições numéricas e links para a origem.
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="flex items-baseline gap-3 border-b border-line pb-2 text-[19px] font-medium text-ink">
        <span className="font-mono text-[12px] text-cyan">{n.padStart(2, "0")}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
