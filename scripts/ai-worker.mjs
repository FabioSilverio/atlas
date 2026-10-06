// Local-model worker for ATLAS (runs in GitHub Actions; free for public repos).
//
// Phase 1 — opinion pieces: asks the site which recent articles lack a summary,
//   reads the first ~2,500 characters of each page in memory only (never stored)
//   and asks an open model served by Ollama for our own summary, a theme and up
//   to three theses.
// Phase 2 — thinkers: for the most notable thinkers without theses, reads the
//   Wikipedia article (sections about their thought/work) and asks for 3–5
//   central theses and key concepts.
// Results go back to the site authenticated with the workflow's GitHub OIDC token.
//
// Env: ATLAS_URL, OLLAMA_MODEL (default qwen2.5:3b), AI_LIMIT, THINKER_LIMIT, AI_DEADLINE_MIN.

const SITE = (process.env.ATLAS_URL ?? "https://atlas-six-pied.vercel.app").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
const LIMIT = Number(process.env.AI_LIMIT ?? 60);
const THINKER_LIMIT = Number(process.env.THINKER_LIMIT ?? 300);
const START = Date.now();
const DEADLINE = START + Number(process.env.AI_DEADLINE_MIN ?? 150) * 60_000;
// Opinion pieces get at most a third of the run; thinkers use the rest.
const ARTICLE_DEADLINE = START + (DEADLINE - START) / 3;
const UA = "ATLAS/0.1 (+https://github.com/FabioSilverio/atlas)";

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error("sem token OIDC: o workflow precisa de permissions.id-token = write");
  const res = await fetch(`${url}&audience=atlas-ingest`, { headers: { Authorization: `Bearer ${bearer}` } });
  return (await res.json()).value;
}

const strip = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function ollama(prompt, numPredict = 320) {
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt, format: "json", stream: false, options: { temperature: 0.2, num_predict: numPredict, num_ctx: 4096 } }),
  });
  return JSON.parse((await res.json()).response);
}

const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : null);

async function post(path, body) {
  const res = await fetch(`${SITE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await oidcToken()}` },
    body: JSON.stringify(body),
  });
  console.log(`→ ${path} ${body.items.length}: HTTP ${res.status} ${await res.text()}`);
}

// ── Phase 1: opinion pieces ────────────────────────────────────

async function excerpt(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000), redirect: "follow" });
    if (!res.ok) return "";
    const html = await res.text();
    const metas = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*content=["']([^"']+)/gi)].map((m) => m[1]);
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((p) => p.length > 60);
    return [...new Set(metas.map(strip))].concat(paras).join("\n").slice(0, 2500);
  } catch {
    return "";
  }
}

const ARTICLE_PROMPT = (a, text) => `Você é um analista de debate público. Analise este texto (${a.outlet}).
Título: ${a.title}
Trecho: ${text || "(indisponível: use só o título)"}

Responda SOMENTE com JSON válido, em português do Brasil, neste formato:
{"resumo": "resumo neutro com no máximo 40 palavras, com suas próprias palavras, sem copiar frases do texto",
 "tema": "tema central em 1 a 3 palavras, minúsculas (ex.: 'inflação', 'eleições 2026', 'guerra na ucrânia')",
 "teses": ["até 3 afirmações centrais que o autor defende, cada uma com no máximo 20 palavras"]}
Se o trecho não permitir identificar teses, devolva "teses": [].`;

async function articles() {
  const { items } = await (await fetch(`${SITE}/api/ai/pending?limit=${LIMIT}`)).json();
  console.log(`colunas pendentes: ${items.length}`);
  let batch = [];
  for (const a of items) {
    if (Date.now() > ARTICLE_DEADLINE) break;
    try {
      const j = await ollama(ARTICLE_PROMPT(a, await excerpt(a.url)));
      batch.push({
        id: a.id,
        summary: clip(j.resumo, 600),
        theme: clip(j.tema, 60),
        theses: (Array.isArray(j.teses) ? j.teses : []).map((t) => clip(t, 240)).filter((t) => t && t.length >= 8).slice(0, 3),
      });
      console.log(`✓ coluna ${a.id} ${j.tema ?? ""} — ${a.title.slice(0, 70)}`);
    } catch (err) {
      batch.push({ id: a.id, summary: null, theme: null, theses: [] }); // do not block the queue
      console.log(`✗ coluna ${a.id}: ${err.message}`);
    }
    if (batch.length >= 10) {
      await post("/api/ai/ingest", { model: MODEL, items: batch });
      batch = [];
    }
  }
  if (batch.length) await post("/api/ai/ingest", { model: MODEL, items: batch });
}

// ── Phase 2: thinkers ──────────────────────────────────────────

const IDEA_HEADINGS = /(pensamento|ideias|filosofia|obra|teoria|contribui|legado|influ[eê]ncia|economia|pol[ií]tica|thought|ideas|philosophy|work|theor|views|contribution|legacy|economics|politic|doctrine|method)/i;

async function wikiText(lang, title) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&prop=extracts|langlinks&explaintext=1&exsectionformat=wiki&lllang=en&redirects=1&titles=${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  const page = (await res.json()).query?.pages?.[0];
  return { text: page?.extract ?? "", en: page?.langlinks?.[0]?.title ?? null };
}

/** Lead + the sections about ideas/work, capped. */
function ideaSections(text) {
  const parts = text.split(/\n(?==+ [^=]+ =+\n)/);
  const lead = parts[0].slice(0, 1500);
  const picked = parts.slice(1).filter((p) => IDEA_HEADINGS.test(p.split("\n")[0]));
  return [lead, ...picked].join("\n").slice(0, 6000);
}

const THINKER_PROMPT = (t, text) => `Você é um historiador das ideias. Com base no texto abaixo sobre ${t.name}${t.description ? ` (${t.description})` : ""}, identifique as principais teses que essa pessoa defendeu.

Texto:
${text}

Responda SOMENTE com JSON válido, em português do Brasil:
{"teses": ["3 a 5 teses centrais, cada uma uma frase afirmativa de até 30 palavras, com suas próprias palavras, atribuíveis a ${t.name} segundo o texto"],
 "conceitos": ["3 a 6 conceitos-chave associados, de 1 a 4 palavras cada"]}
Use apenas o que o texto sustenta; se ele não descreve ideias, devolva listas vazias.`;

async function thinkers() {
  const { items } = await (await fetch(`${SITE}/api/ai/thinkers?limit=${THINKER_LIMIT}`)).json();
  console.log(`pensadores pendentes: ${items.length}`);
  let batch = [];
  for (const t of items) {
    if (Date.now() > DEADLINE) break;
    try {
      const m = t.wiki.match(/^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/);
      if (!m) continue;
      let { text, en } = await wikiText(m[1], decodeURIComponent(m[2]));
      let source = t.wiki;
      // Short Portuguese article: the English one usually describes the ideas better.
      if (text.length < 2500 && m[1] === "pt" && en) {
        const alt = await wikiText("en", en);
        if (alt.text.length > text.length) {
          text = alt.text;
          source = `https://en.wikipedia.org/wiki/${encodeURIComponent(en.replace(/ /g, "_"))}`;
        }
      }
      if (text.length < 300) continue;
      const j = await ollama(THINKER_PROMPT(t, ideaSections(text)), 450);
      const theses = (Array.isArray(j.teses) ? j.teses : []).map((s) => clip(s, 400)).filter((s) => s && s.length >= 10).slice(0, 5);
      const concepts = (Array.isArray(j.conceitos) ? j.conceitos : []).map((s) => clip(s, 80)).filter((s) => s && s.length >= 2).slice(0, 6);
      batch.push({ qid: t.qid, theses, concepts, source });
      console.log(`✓ ${t.name}: ${theses.length} teses`);
    } catch (err) {
      console.log(`✗ ${t.name}: ${err.message}`);
    }
    if (batch.length >= 10) {
      await post("/api/ai/thinkers", { model: MODEL, items: batch });
      batch = [];
    }
  }
  if (batch.length) await post("/api/ai/thinkers", { model: MODEL, items: batch });
}

await articles();
await thinkers();
