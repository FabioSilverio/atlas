import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { countriesByQid } from "../lib/countries";
import { fetchJson } from "../lib/http";
import { touchSource, type Job } from "../lib/job";

type L10n = { en?: string };
type Place = { countryNow?: L10n & { sameAs?: string[] }; locationString?: L10n };
type Laureate = {
  id: string;
  knownName?: L10n;
  orgName?: L10n;
  gender?: string;
  birth?: { date?: string; place?: Place };
  death?: { date?: string };
  founded?: { date?: string; place?: Place };
  wikidata?: { id?: string };
  wikipedia?: { english?: string };
  nobelPrizes: {
    awardYear: string;
    category: L10n;
    motivation?: L10n;
    portion?: string;
    prizeStatus?: string;
    affiliations?: { name?: L10n; countryNow?: L10n & { sameAs?: string[] } }[];
  }[];
};
type Page = { laureates: Laureate[] };

export const CATEGORY: Record<string, string> = {
  Physics: "phy",
  Chemistry: "che",
  "Physiology or Medicine": "med",
  Literature: "lit",
  Peace: "pea",
  "Economic Sciences": "eco",
};

const qidOf = (sameAs?: string[]) => sameAs?.map((u) => u.match(/wikidata\.org\/wiki\/(Q\d+)/)?.[1]).find(Boolean);
// The API uses "1943-00-00" for partial dates.
const isoDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !d.includes("-00") ? d : null);

export const nobelJob: Job = {
  name: "nobel",
  description: "laureados e prêmios (API nobelprize.org v2.1)",
  async run() {
    // Prizes are announced in early October: refresh every 6 h that month, daily otherwise.
    const ttlHours = new Date().getMonth() === 9 ? 6 : 24;
    // Page by offset ourselves: the API's `links.next` points at an internal host.
    const all: Laureate[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await fetchJson<Page>(`https://api.nobelprize.org/2.1/laureates?offset=${offset}&limit=100&sort=asc`, { ttlHours });
      all.push(...page.laureates);
      if (page.laureates.length < 100) break;
    }

    const byQid = await countriesByQid();
    const countryOf = (sameAs?: string[]) => {
      const q = qidOf(sameAs);
      return q ? byQid.get(q) : undefined;
    };

    let prizes = 0;
    let unmappedCountries = 0;
    for (const l of all) {
      const id = Number(l.id);
      const isOrg = !l.knownName && !!l.orgName;
      const name = (isOrg ? l.orgName?.en : l.knownName?.en) ?? `#${id}`;
      const qid = l.wikidata?.id ?? null;

      let personId: number | null = null;
      if (!isOrg && qid) {
        await db
          .insert(schema.people)
          .values({
            wikidataQid: qid,
            name,
            birthDate: isoDate(l.birth?.date),
            deathDate: isoDate(l.death?.date),
            birthCountryCode: countryOf(l.birth?.place?.countryNow?.sameAs) ?? null,
            sourceId: "nobel-api",
            sourceUrl: `https://www.nobelprize.org/laureate/${id}`,
          })
          .onConflictDoNothing();
        [{ id: personId }] = await db.select({ id: schema.people.id }).from(schema.people).where(eq(schema.people.wikidataQid, qid));
      }

      const values = {
        id,
        kind: isOrg ? "org" : "person",
        personId,
        name,
        gender: l.gender ?? null,
        birthDate: isoDate(isOrg ? l.founded?.date : l.birth?.date),
        deathDate: isoDate(l.death?.date),
        birthPlace: (isOrg ? l.founded?.place : l.birth?.place)?.locationString?.en ?? null,
        wikidataQid: qid,
        wikipediaUrl: l.wikipedia?.english ?? null,
        sourceId: "nobel-api",
        sourceUrl: `https://www.nobelprize.org/laureate/${id}`,
        updatedAt: new Date(),
      };
      await db
        .insert(schema.nobelLaureates)
        .values(values)
        .onConflictDoUpdate({ target: schema.nobelLaureates.id, set: { ...values, id: undefined } });

      await db.delete(schema.nobelLaureateCountries).where(eq(schema.nobelLaureateCountries.laureateId, id));
      const origin = countryOf((isOrg ? l.founded?.place : l.birth?.place)?.countryNow?.sameAs);
      if (origin) await db.insert(schema.nobelLaureateCountries).values({ laureateId: id, countryCode: origin, relation: isOrg ? "org_seat" : "birth" });
      else if ((isOrg ? l.founded : l.birth)?.place) unmappedCountries++;

      for (const p of l.nobelPrizes) {
        const category = CATEGORY[p.category.en ?? ""] ?? p.category.en ?? "?";
        const prizeValues = {
          laureateId: id,
          year: Number(p.awardYear),
          category,
          motivation: p.motivation?.en ?? null,
          portion: p.portion ?? null,
          prizeStatus: p.prizeStatus ?? null,
          affiliation: p.affiliations?.map((a) => a.name?.en).filter(Boolean).join("; ") || null,
          sourceId: "nobel-api",
          sourceUrl: `https://www.nobelprize.org/laureate/${id}`,
          updatedAt: new Date(),
        };
        const [prize] = await db
          .insert(schema.nobelPrizes)
          .values(prizeValues)
          .onConflictDoUpdate({
            target: [schema.nobelPrizes.laureateId, schema.nobelPrizes.year, schema.nobelPrizes.category],
            set: { motivation: sql`excluded.motivation`, portion: sql`excluded.portion`, prizeStatus: sql`excluded.prize_status`, affiliation: sql`excluded.affiliation`, updatedAt: new Date() },
          })
          .returning({ id: schema.nobelPrizes.id });
        prizes++;
        const affCountries = new Set(p.affiliations?.map((a) => countryOf(a.countryNow?.sameAs)).filter(Boolean) as string[]);
        for (const c of affCountries) {
          await db.insert(schema.nobelLaureateCountries).values({ laureateId: id, prizeId: prize.id, countryCode: c, relation: "affiliation" });
        }
      }
    }

    // New laureates since the last run become feed events.
    const thisYear = new Date().getFullYear();
    const fresh = await db
      .select({ id: schema.nobelPrizes.id, laureateId: schema.nobelPrizes.laureateId, category: schema.nobelPrizes.category, year: schema.nobelPrizes.year })
      .from(schema.nobelPrizes)
      .where(eq(schema.nobelPrizes.year, thisYear));
    if (fresh.length) {
      const names = await db
        .select({ id: schema.nobelLaureates.id, name: schema.nobelLaureates.name })
        .from(schema.nobelLaureates)
        .where(inArray(schema.nobelLaureates.id, fresh.map((f) => f.laureateId)));
      const homes = await db
        .select()
        .from(schema.nobelLaureateCountries)
        .where(inArray(schema.nobelLaureateCountries.laureateId, fresh.map((f) => f.laureateId)));
      for (const f of fresh) {
        const name = names.find((x) => x.id === f.laureateId)?.name;
        await db
          .insert(schema.events)
          .values({
            type: "nobel_awarded",
            countryCode: homes.find((h) => h.laureateId === f.laureateId && (h.relation === "birth" || h.relation === "org_seat"))?.countryCode ?? null,
            occurredAt: new Date(),
            title: `Nobel ${f.year}: ${name}`,
            payload: { laureateId: f.laureateId, category: f.category, year: f.year },
            dedupeKey: `nobel:${f.year}:${f.category}:${f.laureateId}`,
            sourceId: "nobel-api",
            sourceUrl: `https://www.nobelprize.org/laureate/${f.laureateId}`,
          })
          .onConflictDoNothing();
      }
    }

    await touchSource("nobel-api");
    return { laureates: all.length, prizes, unmappedCountries, prizesThisYear: fresh.length };
  },
};
