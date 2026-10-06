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

// ── Phase 2: thinkers, influence, ideologies ────────────────────

export const thinkers = pgTable(
  "thinkers",
  {
    personId: integer("person_id").primaryKey().references(() => people.id, { onDelete: "cascade" }),
    occupations: jsonb("occupations").$type<{ qid: string; label: string }[]>().notNull().default([]),
    fields: jsonb("fields").$type<{ qid: string; label: string }[]>().notNull().default([]),
    movements: jsonb("movements").$type<{ qid: string; label: string }[]>().notNull().default([]),
    notableWorks: jsonb("notable_works").$type<{ qid: string; label: string }[]>().notNull().default([]),
    awards: jsonb("awards").$type<{ qid: string; label: string }[]>().notNull().default([]),
    sitelinks: integer("sitelinks").notNull().default(0),
    description: text("description"),
    summary: text("summary"), // Wikipedia lead (CC BY-SA), attributed in the UI
    summaryUrl: text("summary_url"),
    birthYear: integer("birth_year"),
    deathYear: integer("death_year"),
    primaryCountry: char("primary_country", { length: 3 }),
    // Central theses and key concepts, written by the local model from the Wikipedia article.
    theses: jsonb("theses").$type<string[]>(),
    concepts: jsonb("concepts").$type<string[]>(),
    thesesModel: text("theses_model"),
    thesesSource: text("theses_source"),
    thesesAt: timestamp("theses_at", { withTimezone: true }),
    ...provenance,
  },
  (t) => [index("thinkers_country_idx").on(t.primaryCountry), index("thinkers_sitelinks_idx").on(t.sitelinks)],
);

export const thinkerCountries = pgTable(
  "thinker_countries",
  {
    personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    countryCode: char("country_code", { length: 3 }).notNull(),
    relation: text("relation").notNull(), // citizenship | birth
  },
  (t) => [primaryKey({ columns: [t.personId, t.countryCode, t.relation] }), index("tc_country_idx").on(t.countryCode)],
);

// Wikidata P737 "influenced by": influencer → influenced.
export const thinkerInfluences = pgTable(
  "thinker_influences",
  {
    influencerId: integer("influencer_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    influencedId: integer("influenced_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    sourceUrl: text("source_url"),
  },
  (t) => [primaryKey({ columns: [t.influencerId, t.influencedId] }), index("ti_influenced_idx").on(t.influencedId)],
);

export const ideologies = pgTable("ideologies", {
  qid: text("qid").primaryKey(),
  name: text("name").notNull(),
  nameEn: text("name_en"),
  description: text("description"),
  summary: text("summary"),
  summaryUrl: text("summary_url"),
  ...provenance,
});

export const partyIdeologies = pgTable(
  "party_ideologies",
  {
    partyId: integer("party_id").notNull().references(() => parties.id, { onDelete: "cascade" }),
    ideologyQid: text("ideology_qid").notNull().references(() => ideologies.qid, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.partyId, t.ideologyQid] }), index("pi_ideology_idx").on(t.ideologyQid)],
);

export const thinkerIdeologies = pgTable(
  "thinker_ideologies",
  {
    personId: integer("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    ideologyQid: text("ideology_qid").notNull().references(() => ideologies.qid, { onDelete: "cascade" }),
    relation: text("relation").notNull(), // ideology | movement
  },
  (t) => [primaryKey({ columns: [t.personId, t.ideologyQid] }), index("thi_ideology_idx").on(t.ideologyQid)],
);

// ── Phase 3: elections and ideological drift ────────────────────

export const elections = pgTable(
  "elections",
  {
    id: serial("id").primaryKey(),
    countryCode: char("country_code", { length: 3 }).notNull(),
    date: date("date").notNull(),
    kind: text("kind").notNull(), // presidential | legislative
    body: text("body").notNull(), // "Chamber of Deputies", "President"…
    title: text("title").notNull(),
    status: text("status").notNull().default("held"), // held | ongoing
    turnout: numeric("turnout"),
    totalSeats: integer("total_seats"),
    // Seat-weighted (legislative) or vote-weighted (presidential) position of the result.
    econ: numeric("econ"),
    galtan: numeric("galtan"),
    coverage: numeric("coverage"), // share of seats/votes whose party has a score
    winner: text("winner"),
    runoffDate: date("runoff_date"),
    wikipediaUrl: text("wikipedia_url"),
    ...provenance,
  },
  (t) => [uniqueIndex("elections_unique").on(t.countryCode, t.date, t.body), index("elections_country_idx").on(t.countryCode, t.date)],
);

export const electionResults = pgTable(
  "election_results",
  {
    id: serial("id").primaryKey(),
    electionId: integer("election_id").notNull().references(() => elections.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    partyLabel: text("party_label").notNull(),
    partyWiki: text("party_wiki"),
    partyId: integer("party_id").references(() => parties.id),
    partyfactsId: integer("partyfacts_id"),
    candidate: text("candidate"),
    seats: integer("seats"),
    seatsBefore: integer("seats_before"),
    votes: numeric("votes"),
    voteShare: numeric("vote_share"),
    econ: numeric("econ"),
    galtan: numeric("galtan"),
    scoreSource: text("score_source"),
  },
  (t) => [index("er_election_idx").on(t.electionId)],
);

// Wikipedia election articles discovered per country; re-read when their revision changes.
export const electionArticles = pgTable(
  "election_articles",
  {
    title: text("title").primaryKey(),
    countryCode: char("country_code", { length: 3 }).notNull(),
    year: integer("year").notNull(),
    revid: integer("revid"),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [index("ea_country_idx").on(t.countryCode)],
);

// Context for the current government: the ruling party's history and ideas, and
// the intellectuals with a documented link to it (party membership or shared
// ideology labels on Wikidata). Rebuilt by the `context` job.
export type ContextPerson = {
  qid: string;
  name: string;
  description: string | null;
  occupations: string[];
  imageUrl: string | null;
  sitelinks: number;
  shared?: string[]; // ideology labels shared with the party/leader
};
export type GovernmentLeader = {
  qid: string;
  name: string;
  ideologies: { qid: string; label: string }[];
  influencedBy: { qid: string; label: string }[];
  description?: string | null;
  summary?: string | null;
  summaryUrl?: string | null;
  imageUrl?: string | null;
  birthYear?: number | null;
  occupations?: string[];
};
export const governmentContext = pgTable("government_context", {
  countryCode: char("country_code", { length: 3 }).primaryKey(),
  party: jsonb("party").$type<{
    qid: string;
    name: string;
    founded: string | null;
    founders: string[];
    chair: string | null;
    alignment: string[];
    ideologies: { qid: string; label: string }[];
    summary: string | null;
    summaryUrl: string | null;
  } | null>(),
  leader: jsonb("leader").$type<GovernmentLeader | null>(),
  affiliated: jsonb("affiliated").$type<ContextPerson[]>().notNull().default([]),
  sharedIdeology: jsonb("shared_ideology").$type<ContextPerson[]>().notNull().default([]),
  ...provenance,
});

// Small key/value store for incremental jobs (scan cursors etc.).
export const jobState = pgTable("job_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// Chief executive per year (Herre 2023 up to 2020; ATLAS snapshots afterwards).
export const executiveHistory = pgTable(
  "executive_history",
  {
    countryCode: char("country_code", { length: 3 }).notNull(),
    year: integer("year").notNull(),
    leader: text("leader"),
    party: text("party"),
    partyfactsId: integer("partyfacts_id"),
    label: text("label"), // leftist | centrist | rightist | none
    econ: numeric("econ"),
    sourceId: text("source_id"),
  },
  (t) => [primaryKey({ columns: [t.countryCode, t.year] })],
);

// ── Phase 4: outlets, columnists, articles, theses, themes ──────

export const outlets = pgTable("outlets", {
  id: text("id").primaryKey(), // slug
  countryCode: char("country_code", { length: 3 }).notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  language: text("language"),
  wikidataQid: text("wikidata_qid"),
  alignment: text("alignment"), // Wikidata P1387 labels, if any
  kind: text("kind").notNull().default("opinion"), // opinion | politics (general feed)
  feeds: jsonb("feeds").$type<string[]>().notNull().default([]),
  ...provenance,
});

export const columnists = pgTable(
  "columnists",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    outletId: text("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
    personId: integer("person_id").references(() => people.id),
    articles: integer("articles").notNull().default(0),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
  },
  (t) => [uniqueIndex("columnists_unique").on(t.outletId, t.name)],
);

// Metadata only — never the article text (copyright). Summaries and theses come from our own model.
export const articles = pgTable(
  "articles",
  {
    id: serial("id").primaryKey(),
    outletId: text("outlet_id").notNull().references(() => outlets.id, { onDelete: "cascade" }),
    columnistId: integer("columnist_id").references(() => columnists.id),
    countryCode: char("country_code", { length: 3 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    author: text("author"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    language: text("language"),
    summary: text("summary"),
    summaryModel: text("summary_model"),
    theme: text("theme"), // topic label from the local model
    aiProcessedAt: timestamp("ai_processed_at", { withTimezone: true }),
    keyphrases: jsonb("keyphrases").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("articles_url").on(t.url), index("articles_country_time").on(t.countryCode, t.publishedAt)],
);

export const theses = pgTable(
  "theses",
  {
    id: serial("id").primaryKey(),
    countryCode: char("country_code", { length: 3 }).notNull(),
    text: text("text").notNull(),
    theme: text("theme"),
    model: text("model").notNull(),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull(),
    mentions: integer("mentions").notNull().default(1),
  },
  (t) => [index("theses_country_idx").on(t.countryCode, t.lastSeen)],
);

export const thesisMentions = pgTable(
  "thesis_mentions",
  {
    thesisId: integer("thesis_id").notNull().references(() => theses.id, { onDelete: "cascade" }),
    articleId: integer("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.thesisId, t.articleId] })],
);

// Rolling theme trends per country ('WLD' = world), recomputed daily.
export const themeTrends = pgTable(
  "theme_trends",
  {
    countryCode: char("country_code", { length: 3 }).notNull(),
    theme: text("theme").notNull(),
    recent: integer("recent").notNull(), // mentions in the last 7 days
    previous: integer("previous").notNull(), // mentions in the 21 days before
    trend: text("trend").notNull(), // rising | stable | falling | new
    sampleArticleIds: jsonb("sample_article_ids").$type<number[]>().notNull().default([]),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.countryCode, t.theme] })],
);

// ── Phase 5: global search ─────────────────────────────────────

export const searchIndex = pgTable(
  "search_index",
  {
    kind: text("kind").notNull(), // country | person | thinker | party | ideology | theme | election
    ref: text("ref").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    countryCode: char("country_code", { length: 3 }),
    url: text("url").notNull(),
    weight: numeric("weight").notNull().default("0"),
    norm: text("norm").notNull(), // accent-free lowercase haystack
  },
  (t) => [primaryKey({ columns: [t.kind, t.ref] })],
);
