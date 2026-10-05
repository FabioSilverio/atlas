import { fetchJson, type FetchOptions } from "./http";

type Binding = { type: string; value: string; "xml:lang"?: string };
type SparqlJson = { results: { bindings: Record<string, Binding>[] } };

const ENDPOINT = "https://query.wikidata.org/sparql";

/** Runs a Wikidata SPARQL query and returns flat rows ({var: value}). */
export async function sparql(query: string, opts: FetchOptions = {}): Promise<Record<string, string>[]> {
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const json = await fetchJson<SparqlJson>(url, {
    ttlHours: 12,
    ...opts,
    headers: { Accept: "application/sparql-results+json", ...opts.headers },
  });
  return json.results.bindings.map((b) =>
    Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])),
  );
}

export const qid = (uri: string | undefined) => uri?.match(/Q\d+$/)?.[0];
