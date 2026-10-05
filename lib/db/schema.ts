import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Every factual row carries provenance: which dataset (source_id), the most
// specific URL for that record (source_url) and when we last wrote it.
const provenance = {
  sourceId: text("source_id").references(() => sources.id),
  sourceUrl: text("source_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Provenance & infra ─────────────────────────────────────────

export const sources = pgTable("sources", {
  id: text("id").primaryKey(), // 'ches-2024', 'gps-2019', 'nobel-api-2.1', 'wikidata'…
  name: text("name").notNull(),
  publisher: text("publisher"),
  url: text("url").notNull(),
  license: text("license"),
  citation: text("citation"),
  version: text("version"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
});

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  job: text("job").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | ok | error
  stats: jsonb("stats"),
  error: text("error"),
});

// ── Core ───────────────────────────────────────────────────────

export const countries = pgTable("countries", {
  // ISO 3166-1 alpha-3 when it exists; Natural Earth ADM0_A3 otherwise (KOS, SOL, CYN…)
  code: char("code", { length: 3 }).primaryKey(),
  iso2: char("iso2", { length: 2 }),
  wikidataQid: text("wikidata_qid").unique(),
  namePt: text("name_pt").notNull(),
  nameEn: text("name_en").notNull(),
  continent: text("continent"),
  region: text("region"),
  subregion: text("subregion"),
  neType: text("ne_type"), // Natural Earth TYPE: Sovereign country | Dependency | Disputed…
  sovereignCode: char("sovereign_code", { length: 3 }),
  isDisputed: boolean("is_disputed").notNull().default(false),
  disputeNote: text("dispute_note"),
  population: numeric("population"),
  // V-Dem Regimes of the World (via Our World in Data)
  regimeType: text("regime_type"), // closed_autocracy | electoral_autocracy | electoral_democracy | liberal_democracy
  regimeYear: integer("regime_year"),
  regimeSourceId: text("regime_source_id").references(() => sources.id),
  ...provenance,
});

export const people = pgTable("people", {
  id: serial("id").primaryKey(),
  wikidataQid: text("wikidata_qid").unique(),
  name: text("name").notNull(),
  nameNative: text("name_native"),
  birthDate: date("birth_date"),
  deathDate: date("death_date"),
  birthCountryCode: char("birth_country_code", { length: 3 }),
  imageUrl: text("image_url"),
  imageLicense: text("image_license"),
  imageAttribution: text("image_attribution"),
  ...provenance,
});

export const parties = pgTable(
  "parties",
  {
    id: serial("id").primaryKey(),
    countryCode: char("country_code", { length: 3 }),
    name: text("name").notNull(),
    nameEn: text("name_en"),
    abbrev: text("abbrev"),
    family: text("family"),
    wikidataQid: text("wikidata_qid").unique(),
    enwiki: text("enwiki"),
    partyfactsId: integer("partyfacts_id").unique(),
    parlgovId: integer("parlgov_id"),
    chesId: integer("ches_id"),
    gpsId: integer("gps_id"),
    vpartyId: integer("vparty_id"),
    marporId: integer("marpor_id"),
    ...provenance,
  },
  (t) => [index("parties_country_idx").on(t.countryCode)],
);

export const governments = pgTable(
  "governments",
  {
    id: serial("id").primaryKey(),
    countryCode: char("country_code", { length: 3 }).notNull().references(() => countries.code),
    headOfStateId: integer("head_of_state_id").references(() => people.id),
    headOfGovernmentId: integer("head_of_government_id").references(() => people.id),
    // Whose ideology counts as "the government's": see lib/ideology/derive.ts
    chiefExecutiveRole: text("chief_executive_role").notNull(), // head_of_state | head_of_government
    chiefExecutiveRule: text("chief_executive_rule").notNull(), // human-readable justification
    startedOn: date("started_on"),
    endedOn: date("ended_on"), // null = current
    nextElectionOn: date("next_election_on"),
    nextElectionName: text("next_election_name"),
    nextElectionConfirmed: boolean("next_election_confirmed"),
    nextElectionSourceUrl: text("next_election_source_url"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...provenance,
  },
  (t) => [
    uniqueIndex("governments_one_current_per_country")
      .on(t.countryCode)
      .where(sql`${t.endedOn} is null`),
  ],
);

export const governmentParties = pgTable(
  "government_parties",
  {
    governmentId: integer("government_id").notNull().references(() => governments.id, { onDelete: "cascade" }),
    partyId: integer("party_id").notNull().references(() => parties.id),
    role: text("role").notNull(), // leader | other_head | coalition | support
    position: integer("position").notNull().default(0), // 0 = most recent membership
    memberSince: date("member_since"),
    seatShare: numeric("seat_share"),
  },
  (t) => [primaryKey({ columns: [t.governmentId, t.partyId] })],
);

// Raw positions, one row per source × subject × dimension. Never averaged across sources.
export const ideologyScores = pgTable(
  "ideology_scores",
  {
    id: serial("id").primaryKey(),
    partyId: integer("party_id").references(() => parties.id),
    personId: integer("person_id").references(() => people.id),
    countryCode: char("country_code", { length: 3 }),
    dimension: text("dimension").notNull(), // econ_lr | galtan | general_lr
    rawValue: numeric("raw_value"),
    rawLabel: text("raw_label"), // categorical sources (e.g. Herre: 'leftist')
    scaleMin: numeric("scale_min"),
    scaleMax: numeric("scale_max"),
    valueNorm: numeric("value_norm").notNull(), // -1 (left / libertarian) … +1 (right / authoritarian)
    observedYear: integer("observed_year"),
    method: text("method").notNull(), // expert_survey | manifesto | leader_coding | editorial_estimate
    subjectName: text("subject_name"), // name as written in the source dataset
    notes: text("notes"),
    ...provenance,
  },
  (t) => [
    index("scores_party_idx").on(t.partyId),
    index("scores_person_idx").on(t.personId),
    check(
      "scores_one_subject",
      sql`num_nonnulls(${t.partyId}, ${t.personId}, ${t.countryCode}) = 1`,
    ),
  ],
);

// Derived; recomputed after every ingestion. This is what the map reads.
export const governmentPositions = pgTable(
  "government_positions",
  {
    governmentId: integer("government_id").notNull().references(() => governments.id, { onDelete: "cascade" }),
    dimension: text("dimension").notNull(),
    valueNorm: numeric("value_norm"), // null = no usable data
    confidence: char("confidence", { length: 1 }), // A | B | C | D
    isEstimate: boolean("is_estimate").notNull().default(false),
    derivation: jsonb("derivation").notNull(), // { rule, inputs:[{scoreId, weight, …}], explanation }
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.governmentId, t.dimension] })],
);

// ── Nobel ──────────────────────────────────────────────────────

export const nobelLaureates = pgTable("nobel_laureates", {
  id: integer("id").primaryKey(), // nobelprize.org id
  kind: text("kind").notNull(), // person | org
  personId: integer("person_id").references(() => people.id),
  name: text("name").notNull(),
  gender: text("gender"),
  birthDate: date("birth_date"),
  deathDate: date("death_date"),
  birthPlace: text("birth_place"),
  wikidataQid: text("wikidata_qid"),
  wikipediaUrl: text("wikipedia_url"),
  ...provenance,
});

export const nobelPrizes = pgTable(
  "nobel_prizes",
  {
    id: serial("id").primaryKey(),
    laureateId: integer("laureate_id").notNull().references(() => nobelLaureates.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    category: text("category").notNull(), // phy | che | med | lit | pea | eco
    motivation: text("motivation"),
    portion: text("portion"),
    prizeStatus: text("prize_status"),
    affiliation: text("affiliation"),
    ...provenance,
  },
  (t) => [uniqueIndex("nobel_prizes_unique").on(t.laureateId, t.year, t.category)],
);

export const nobelLaureateCountries = pgTable(
  "nobel_laureate_countries",
  {
    laureateId: integer("laureate_id").notNull().references(() => nobelLaureates.id, { onDelete: "cascade" }),
    prizeId: integer("prize_id").references(() => nobelPrizes.id, { onDelete: "cascade" }),
    countryCode: char("country_code", { length: 3 }).notNull(),
    relation: text("relation").notNull(), // birth | affiliation | org_seat
  },
  (t) => [index("nlc_country_idx").on(t.countryCode, t.relation)],
);

// ── Events (feed; populated from Phase 1 by government-change diffs) ─

export const events = pgTable(
  "events",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(), // government_change | nobel_awarded | election_held …
    countryCode: char("country_code", { length: 3 }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    title: text("title").notNull(),
    payload: jsonb("payload"),
    dedupeKey: text("dedupe_key").unique(),
    ...provenance,
  },
  (t) => [index("events_time_idx").on(t.occurredAt)],
);
