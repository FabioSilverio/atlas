// Local-model worker for ATLAS (runs in GitHub Actions; free for public repos).
//
// 1. Asks the site which recent opinion pieces still lack a summary.
// 2. Reads each page once, keeping only the first ~2,500 characters of text in
//    memory (never stored anywhere), and asks an open model served by Ollama for
//    our own short summary, a theme label and up to three theses.
// 3. Sends the results back, authenticated with the workflow's GitHub OIDC token.
//
// Env: ATLAS_URL, OLLAMA_MODEL (default qwen2.5:3b), AI_LIMIT, AI_DEADLINE_MIN.

const SITE = (process.env.ATLAS_URL ?? "https://atlas-six-pied.vercel.app").replace(/\/$/, "");
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:3b";
const LIMIT = Number(process.env.AI_LIMIT ?? 80);
const DEADLINE = Date.now() + Number(process.env.AI_DEADLINE_MIN ?? 150) * 60_000;
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

/** Description meta tags + first paragraphs, capped. Kept in memory only for the prompt. */
async function excerpt(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return "";
    const html = await res.text();
    const metas = [...html.matchAll(/<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*content=["']([^"']+)/gi)].map((m) => m[1]);
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => strip(m[1])).filter((p) => p.length > 60);
    return [...new Set(metas.map(strip))].concat(paras).join("\n").slice(0, 2500);
  } catch {
    return "";
  }
}

const PROMPT = (a, text) => `Você é um analista de debate público. Analise esta coluna de opinião (${a.outlet}).
Título: ${a.title}
Trecho: ${text || "(indisponível: use só o título)"}

Responda SOMENTE com JSON válido, em português do Brasil, neste formato:
{"resumo": "resumo neutro com no máximo 40 palavras, com suas próprias palavras, sem copiar frases do texto",
 "tema": "tema central em 1 a 3 palavras, minúsculas (ex.: 'inflação', 'eleições 2026', 'guerra na ucrânia')",
 "teses": ["até 3 afirmações centrais que o autor defende, cada uma com no máximo 20 palavras"]}
Se o trecho não permitir identificar teses, devolva "teses": [].`;

async function analyse(a) {
  const text = await excerpt(a.url);
  const res = await fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, prompt: PROMPT(a, text), format: "json", stream: false, options: { temperature: 0.2, num_predict: 320 } }),
  });
  const out = await res.json();
  const j = JSON.parse(out.response);
  const clip = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : null);
  return {
    id: a.id,
    summary: clip(j.resumo, 600),
    theme: clip(j.tema, 60),
    theses: (Array.isArray(j.teses) ? j.teses : []).map((t) => clip(t, 240)).filter((t) => t && t.length >= 8).slice(0, 3),
  };
}

async function send(token, items) {
  if (!items.length) return;
  const res = await fetch(`${SITE}/api/ai/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ model: MODEL, items }),
  });
  console.log(`enviado ${items.length}: HTTP ${res.status} ${await res.text()}`);
}

const token = await oidcToken();
const { items } = await (await fetch(`${SITE}/api/ai/pending?limit=${LIMIT}`)).json();
console.log(`pendentes: ${items.length}`);
let batch = [];
for (const a of items) {
  if (Date.now() > DEADLINE) break;
  try {
    const r = await analyse(a);
    batch.push(r);
    console.log(`✓ ${a.id} ${r.theme ?? ""} — ${a.title.slice(0, 70)}`);
  } catch (err) {
    // Mark as processed anyway so a bad page does not block the queue.
    batch.push({ id: a.id, summary: null, theme: null, theses: [] });
    console.log(`✗ ${a.id}: ${err.message}`);
  }
  if (batch.length >= 10) {
    await send(await oidcToken(), batch);
    batch = [];
  }
}
await send(await oidcToken(), batch);
void token;
