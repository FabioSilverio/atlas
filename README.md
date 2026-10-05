# ATLAS

Painel global de quem governa cada país e de onde esse governo está no espectro ideológico, com fontes acadêmicas rastreáveis. Também mostra os ganhadores do Nobel por país. Público: jornalismo e análise.

**No ar:** https://atlas-six-pied.vercel.app

- **Mapa:** camadas de eixo econômico, eixo cultural, eleições recentes (deriva), densidade de pensadores (com arcos de influência), Nobel e debate de opinião.
- **Dossiê de país:** governo em contexto (história do partido no poder, como chegou lá, situação atual, intelectuais ligados), posição ideológica com derivação explicada, eleições e deriva de 20 anos, pensadores e influências estrangeiras, Nobel, colunistas, temas e teses em circulação, fontes.
- **Páginas:** pensador (`/pensador/Q…`), ideologia (`/ideologia/Q…`), índices (`/pensadores`, `/ideologias`), busca global (`/busca`), metodologia.
- **Feed** de eventos ao vivo (troca de governo, eleição, Nobel, tema ou tese ganhando tração).

## Rodando localmente

Pré-requisitos: Node 24+.

```bash
npm install
cp .env.example .env.local
npm run db            # terminal 1: Postgres local (PGlite) em 127.0.0.1:54329
npm run db:push       # cria as tabelas
npm run ingest -- all # baixa e processa as fontes (~1 min na primeira vez)
npm run dev           # terminal 2: http://localhost:3000
```

Outros comandos:

| comando | o que faz |
|---|---|
| `npm run ingest -- <job>` | roda um job: `sources`, `geo`, `regimes`, `governments`, `parties`, `scores`, `derive`, `nobel` |
| `npm run ingest -- ideology` | só o que muda com frequência (governos → posições) |
| `npm run ingest -- knowledge` | pensadores, ideologias, governo em contexto (semanal) |
| `npm run ingest -- elections` | eleições desde 2005 + histórico do executivo |
| `npm run ingest -- opinion` | feeds de opinião, temas e índice de busca |
| `npm test` | testes da lógica de classificação |
| `npm run db:studio` | navegador do banco (Drizzle Studio) |

As respostas das fontes ficam em cache em `data/cache/` (24 h para APIs, 30 dias para bases acadêmicas), então rodar de novo é rápido e não sobrecarrega ninguém.

## Como funciona

```
Wikidata ─┐                                   ┌─> government_positions ─> mapa / dossiê
Herre ────┼─> governments ─> parties ─────────┤
ElectionGuide ┘        Party Facts (crosswalk)│
CHES · ParlGov · GPS · Herre ─> ideology_scores┘
Nobel API ─> nobel_laureates / prizes / countries
```

- **Quem governa:** Wikidata (P35/P6/P102). Quem conta como chefe do executivo segue uma regra explícita (Herre/V-Dem + correções em `data/seed/overrides/governments.json`).
- **Posição:** partido do chefe do executivo → Party Facts → melhor fonte disponível na hierarquia CHES > ParlGov > GPS > Herre. Fontes nunca são misturadas por média. Confiança A–D.
- **Detalhes e limites:** página `/metodologia` do próprio site.

Correções manuais ficam versionadas e exigem justificativa e fonte:

- `data/seed/overrides/governments.json`: quem é o chefe do executivo, troca de pessoas ou partidos.
- `data/seed/party-crosswalk.json`: ligação de partidos que o Party Facts ainda não conhece.
- `data/seed/disputed.json`: territórios disputados.

## IA local (gratuita)

Resumos de colunas, temas e teses vêm de um modelo aberto (Qwen 2.5 3B, Apache 2.0) servido pelo Ollama dentro do GitHub Actions (`.github/workflows/ai.yml`, a cada 4 h; gratuito em repositório público). O worker (`scripts/ai-worker.mjs`) pega as colunas pendentes em `/api/ai/pending`, lê o trecho inicial da página só em memória e devolve resumo, tema e teses para `/api/ai/ingest`. A autenticação usa o token OIDC do próprio GitHub Actions, então não há segredo para configurar. Nenhuma classificação ideológica é feita por IA.

## Estrutura

```
app/                  páginas (/, /pais/[code], /metodologia) e rotas de API
components/           map/, shell/, dossier/, ui/
lib/db/               schema Drizzle + cliente
lib/ideology/         regras puras (chefe do executivo, hierarquia, confiança) — testadas
lib/queries.ts        leituras do site (com cache, revalidadas após cada ingestão)
ingest/               jobs de ingestão + cache HTTP com rate limit
data/seed/            correções editoriais e registro de fontes (versionados)
public/geo/           geometria Natural Earth em TopoJSON (gerada pelo job geo)
```

## Deploy

Produção na Vercel (projeto `atlas`, região gru1) com Postgres Neon criado pela integração da Vercel. Cada push em `main` publica. A ingestão roda no Vercel Cron (`vercel.json`): opinião 05:00, governos/Nobel 06:30, eleições 08:00 (UTC) e pensadores/contexto às segundas. Para uma carga manual no Neon, rode `vercel env pull .env.neon --environment=production` e depois `npx tsx --env-file=.env.neon ingest/run.ts all`.

## Fontes

Natural Earth · Wikidata · Party Facts · Chapel Hill Expert Survey (Europa 2024, América Latina 2020, Canadá 2023, Israel 2022) · ParlGov · Global Party Survey 2019 · Herre (2023) Global Leader Ideology · V-Dem Regimes of the World (via Our World in Data) · ElectionGuide (IFES) · Nobel Prize API v2.1. Citações completas em `/metodologia`.
