import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { log } from "./log";

// File-based HTTP cache. Works the same locally and in GitHub Actions (where
// data/cache is persisted with actions/cache), and keeps us well inside the
// rate limits of every upstream: a cached response younger than `ttlHours` is
// served without touching the network; an older one is revalidated with
// ETag / Last-Modified.

// On Vercel only /tmp is writable (and ephemeral); locally the cache persists in data/cache.
const CACHE_DIR = process.env.VERCEL ? path.join(os.tmpdir(), "atlas-cache") : path.join(process.cwd(), "data", "cache");
// Wikimedia's policy asks for a contact in the User-Agent: set ATLAS_CONTACT.
export const USER_AGENT = `ATLAS/0.1 (painel de pesquisa jornalistica; ${process.env.ATLAS_CONTACT || "https://github.com/FabioSilverio/atlas"})`;

type Meta = { url: string; fetchedAt: string; etag?: string; lastModified?: string; status: number };

// Minimum spacing between requests to the same host.
const HOST_INTERVAL_MS: Record<string, number> = {
  "query.wikidata.org": 800,
  "api.nobelprize.org": 300,
  "www.electionguide.org": 2000,
  "en.wikipedia.org": 1000,
  "pt.wikipedia.org": 1000,
  "commons.wikimedia.org": 1000,
  "news.google.com": 1500,
  default: 500,
};
const lastHit = new Map<string, number>();

async function throttle(host: string) {
  const gap = HOST_INTERVAL_MS[host] ?? HOST_INTERVAL_MS.default;
  const wait = (lastHit.get(host) ?? 0) + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

export type FetchOptions = {
  ttlHours?: number;
  headers?: Record<string, string>;
  /** Bypass the TTL (still uses conditional requests). */
  force?: boolean;
};

export async function fetchCached(url: string, opts: FetchOptions = {}): Promise<Buffer> {
  const { ttlHours = 24, headers = {}, force = false } = opts;
  const key = createHash("sha1").update(url + JSON.stringify(headers)).digest("hex");
  const bodyPath = path.join(CACHE_DIR, `${key}.body`);
  const metaPath = path.join(CACHE_DIR, `${key}.meta.json`);
  await mkdir(CACHE_DIR, { recursive: true });

  let meta: Meta | null = null;
  try {
    meta = JSON.parse(await readFile(metaPath, "utf8"));
  } catch {}

  if (meta && !force) {
    const ageH = (Date.now() - new Date(meta.fetchedAt).getTime()) / 3.6e6;
    if (ageH < ttlHours) return readFile(bodyPath);
  }

  const host = new URL(url).host;
  const reqHeaders: Record<string, string> = { "User-Agent": USER_AGENT, ...headers };
  if (meta?.etag) reqHeaders["If-None-Match"] = meta.etag;
  if (meta?.lastModified) reqHeaders["If-Modified-Since"] = meta.lastModified;

  for (let attempt = 1; ; attempt++) {
    await throttle(host);
    let res: Response;
    try {
      res = await fetch(url, { headers: reqHeaders, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      if (attempt >= 4) throw err;
      log.warn(`rede falhou (${(err as Error).message}); tentativa ${attempt}`, url);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    if (res.status === 304 && meta) {
      meta.fetchedAt = new Date().toISOString();
      await writeFile(metaPath, JSON.stringify(meta));
      return readFile(bodyPath);
    }
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get("retry-after")) || 5 * attempt;
      if (attempt >= 4) {
        // Serve stale rather than fail the whole job when upstream is down.
        if (meta) {
          log.warn(`HTTP ${res.status}; usando cache antigo`, url);
          return readFile(bodyPath);
        }
        throw new Error(`HTTP ${res.status} em ${url}`);
      }
      log.warn(`HTTP ${res.status}; aguardando ${retryAfter}s`, url);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);

    const body = Buffer.from(await res.arrayBuffer());
    await writeFile(bodyPath, body);
    const newMeta: Meta = {
      url,
      fetchedAt: new Date().toISOString(),
      status: res.status,
      etag: res.headers.get("etag") ?? undefined,
      lastModified: res.headers.get("last-modified") ?? undefined,
    };
    await writeFile(metaPath, JSON.stringify(newMeta));
    return body;
  }
}

export async function fetchJson<T>(url: string, opts?: FetchOptions): Promise<T> {
  return JSON.parse((await fetchCached(url, opts)).toString("utf8")) as T;
}

export async function fetchText(url: string, opts?: FetchOptions): Promise<string> {
  return (await fetchCached(url, opts)).toString("utf8");
}
