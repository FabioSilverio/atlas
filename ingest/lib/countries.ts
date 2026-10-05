import { db, schema } from "@/lib/db/client";
import { loadNeNames } from "../jobs/geo";
import { norm } from "./text";

// Names used by ElectionGuide / Herre / CHES that Natural Earth spells differently.
const ALIASES: Record<string, string> = {
  "ivory coast": "CIV",
  "cote d ivoire": "CIV",
  "republic of the congo": "COG",
  "congo brazzaville": "COG",
  "democratic republic of the congo": "COD",
  "congo kinshasa": "COD",
  "czech republic": "CZE",
  czechia: "CZE",
  "north macedonia": "MKD",
  macedonia: "MKD",
  "east timor": "TLS",
  "timor leste": "TLS",
  "the gambia": "GMB",
  gambia: "GMB",
  "cape verde": "CPV",
  "cabo verde": "CPV",
  eswatini: "SWZ",
  swaziland: "SWZ",
  burma: "MMR",
  myanmar: "MMR",
  "south korea": "KOR",
  "republic of korea": "KOR",
  "north korea": "PRK",
  "united states": "USA",
  "united states of america": "USA",
  "united kingdom": "GBR",
  russia: "RUS",
  "russian federation": "RUS",
  "bosnia herzegovina": "BIH",
  "bosnia and herzegovina": "BIH",
  "sao tome and principe": "STP",
  "palestinian territories": "PSE",
  palestine: "PSE",
  kosovo: "XKX",
  "vatican city": "VAT",
  "holy see": "VAT",
  "federated states of micronesia": "FSM",
  micronesia: "FSM",
  "st kitts and nevis": "KNA",
  "saint kitts and nevis": "KNA",
  "st lucia": "LCA",
  "saint lucia": "LCA",
  "st vincent and the grenadines": "VCT",
  "saint vincent and the grenadines": "VCT",
  turkiye: "TUR",
  turkey: "TUR",
  "republic of vietnam": "VNM",
  vietnam: "VNM",
  laos: "LAO",
  brunei: "BRN",
  syria: "SYR",
  iran: "IRN",
  bolivia: "BOL",
  venezuela: "VEN",
  tanzania: "TZA",
  moldova: "MDA",
  taiwan: "TWN",
};

export type CountryMatcher = (name: string) => string | undefined;

export async function countryMatcher(): Promise<CountryMatcher> {
  const map = new Map<string, string>();
  for (const [name, code] of await loadNeNames()) map.set(norm(name), code);
  const rows = await db.select({ code: schema.countries.code, pt: schema.countries.namePt, en: schema.countries.nameEn }).from(schema.countries);
  for (const r of rows) {
    map.set(norm(r.en), r.code);
    map.set(norm(r.pt), r.code);
  }
  for (const [k, v] of Object.entries(ALIASES)) map.set(norm(k), v);
  return (name) => map.get(norm(name)) ?? map.get(norm(name.replace(/^the /i, "")));
}

/** Map of Wikidata QID → ATLAS country code. */
export async function countriesByQid(): Promise<Map<string, string>> {
  const rows = await db.select({ code: schema.countries.code, qid: schema.countries.wikidataQid }).from(schema.countries);
  return new Map(rows.filter((r) => r.qid).map((r) => [r.qid!, r.code]));
}
