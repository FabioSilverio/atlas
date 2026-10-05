# ATLAS

Painel global de quem governa cada país e de onde esse governo está no espectro ideológico, com fontes acadêmicas rastreáveis. Também mostra os ganhadores do Nobel por país. Público: jornalismo e análise.

**Fase 1 (concluída):** mapa-múndi em globo, camadas "eixo econômico", "eixo cultural" e "Nobel por país", dossiê de país (cabeçalho, posição ideológica com a derivação explicada, Nobel), página de metodologia e versão mobile.

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

## Deploy na Vercel

1. Suba o repositório para o GitHub e importe na Vercel.
2. Na Vercel: **Storage → Neon** (Marketplace) para criar o Postgres. Isso preenche `DATABASE_URL`.
3. Em **Settings → Environment Variables**, adicione `CRON_SECRET` (um valor aleatório longo).
4. Faça a primeira carga no Neon a partir do seu computador. Troque temporariamente `DATABASE_URL` no `.env.local` pela URL do Neon e rode `npm run db:push` e depois `npm run ingest -- all`.
5. No GitHub, em **Settings → Secrets → Actions**, crie `DATABASE_URL`, `CRON_SECRET`, `REVALIDATE_URL` (a URL da Vercel) e `ATLAS_CONTACT`. O workflow `.github/workflows/ingest.yml` atualiza tudo diariamente.
6. O cron da Vercel (`vercel.json`) atualiza o Nobel uma vez por dia. Em outubro, o GitHub Actions roda a cada 6 h.

## Fontes

Natural Earth · Wikidata · Party Facts · Chapel Hill Expert Survey (Europa 2024, América Latina 2020, Canadá 2023, Israel 2022) · ParlGov · Global Party Survey 2019 · Herre (2023) Global Leader Ideology · V-Dem Regimes of the World (via Our World in Data) · ElectionGuide (IFES) · Nobel Prize API v2.1. Citações completas em `/metodologia`.
