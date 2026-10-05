import { parse } from "csv-parse/sync";
import { fetchCached } from "./http";

// Loaders for the bulk academic datasets. Each is downloaded once and cached
// for 30 days in data/cache (they change at most a few times a year).

type Row = Record<string, string>;
const MONTH = 24 * 30;

async function csv(url: string, opts: { delimiter?: string; ttlHours?: number; encoding?: BufferEncoding } = {}): Promise<Row[]> {
  const buf = await fetchCached(url, { ttlHours: opts.ttlHours ?? MONTH });
  return parse(opts.encoding ? buf.toString(opts.encoding) : buf, {
    columns: true,
    delimiter: opts.delimiter ?? ",",
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as Row[];
}

export const URLS = {
  partyfactsCore: "https://partyfacts.herokuapp.com/download/core-parties-csv/",
  partyfactsExternal: "https://partyfacts.herokuapp.com/download/external-parties-csv/",
  gps: "https://dataverse.harvard.edu/api/access/datafile/3788853", // tab-delimited export of the party-level file
  parlgov: "https://www.parlgov.org/data/parlgov-development_csv-utf-8/view_party.csv",
  chesEurope: "https://github.com/chesdata/chesdata.github.io/releases/download/ches-europe/CHES_2024_final_v2.csv",
  chesLa: "https://github.com/chesdata/chesdata.github.io/releases/download/ches-la/ches_la_2020_aggregate_level_v01.csv",
  chesCanada: "https://github.com/chesdata/chesdata.github.io/releases/download/ches-canada/CHES_CA2023.csv",
  chesIsrael: "https://github.com/chesdata/chesdata.github.io/releases/download/ches-israel/CHES_ISRAEL_means_2021_2022.csv",
  herre: "https://raw.githubusercontent.com/bastianherre/global-leader-ideologies/main/global_leader_ideologies.csv",
};

export const loadPartyFactsCore = () => csv(URLS.partyfactsCore, { ttlHours: 24 * 7 });
export const loadPartyFactsExternal = () => csv(URLS.partyfactsExternal, { ttlHours: 24 * 7 });
export const loadGps = () => csv(URLS.gps, { delimiter: "\t" });
export const loadParlgov = () => csv(URLS.parlgov);
export const loadChesEurope = () => csv(URLS.chesEurope);
export const loadChesLa = () => csv(URLS.chesLa, { encoding: "latin1" }); // published as Windows-1252
export const loadChesCanada = () => csv(URLS.chesCanada);
export const loadChesIsrael = () => csv(URLS.chesIsrael);

export type HerreRow = Row;
/** Herre's Global Leader Ideology dataset, most recent year only (2020). */
export async function loadHerreLatest(): Promise<HerreRow[]> {
  const rows = await csv(URLS.herre);
  const maxYear = Math.max(...rows.map((r) => Number(r.year)));
  return rows.filter((r) => Number(r.year) === maxYear);
}
