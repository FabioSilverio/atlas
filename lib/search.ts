import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export type SearchHit = { kind: string; ref: string; title: string; subtitle: string | null; url: string; countryCode: string | null };

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Every word must appear; titles that start with the query rank first, then by weight. */
export async function search(q: string, limit = 30): Promise<SearchHit[]> {
  const words = fold(q).split(" ").filter((w) => w.length >= 2).slice(0, 6);
  if (!words.length) return [];
  const conds = sql.join(
    words.map((w) => sql`norm like ${"%" + w + "%"}`),
    sql` and `,
  );
  const first = fold(q);
  const rows = (await db.execute(sql`
    select kind, ref, title, subtitle, url, country_code
    from search_index where ${conds}
    order by (norm like ${first + "%"}) desc, weight desc
    limit ${limit}`)) as unknown as { kind: string; ref: string; title: string; subtitle: string | null; url: string; country_code: string | null }[];
  return rows.map((r) => ({ kind: r.kind, ref: r.ref, title: r.title, subtitle: r.subtitle, url: r.url, countryCode: r.country_code?.trim() ?? null }));
}

export const KIND_LABEL: Record<string, string> = {
  country: "País",
  person: "Pessoa",
  thinker: "Pensador",
  party: "Partido",
  ideology: "Ideologia",
  theme: "Tema",
  election: "Eleição",
  laureate: "Nobel",
};
