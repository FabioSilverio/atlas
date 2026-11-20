// Hourly consistency audit of every country page, run by the pipeline after ingestion.
// It applies the same rules the site uses (lib/government-context.ts) to every country and
// lists what a reader would see as wrong or outdated: counts left "ongoing", a head of state
// who lost the last vote, re-elections not shown, a Senate shown as the governing majority…
// Writes the report to stdout and to the GitHub step summary. Never blocks publishing.
//
//   tsx --env-file-if-exists=.env.local scripts/audit-countries.ts
import { appendFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditCountry, type AuditInput, type AuditIssue, type ElectionItem } from "@/lib/government-context";

const rows = async <T,>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];
const num = (v: unknown) => (v == null ? null : Number(v));
const day = (v: string | Date | null) => (v == null ? null : new Date(v).toISOString().slice(0, 10));

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const countries = await rows<{ code: string; name: string; sovereign: boolean }>(sql`select code, name_pt as name, (ne_type ~ 'Sovereign|Country') as sovereign from countries`);
  const govs = await rows<{ code: string; role: string; since: string | null; next: string | null; name: string | null; party_name: string | null; party_pf: number | null; econ: string | null; galtan: string | null }>(sql`
    select g.country_code as code, g.chief_executive_role as role, g.started_on as since, g.next_election_on as next, pe.name,
      (select pa.name from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_name,
      (select pa.partyfacts_id from government_parties x join parties pa on pa.id = x.party_id where x.government_id = g.id and x.role = 'leader' order by x.position limit 1) as party_pf,
      (select value_norm from government_positions p where p.government_id = g.id and p.dimension = 'econ_lr') as econ,
      (select value_norm from government_positions p where p.government_id = g.id and p.dimension = 'galtan') as galtan
    from governments g
    left join people pe on pe.id = case when g.chief_executive_role = 'head_of_state' then g.head_of_state_id else g.head_of_government_id end
    where g.ended_on is null`);
  const els = await rows<{ id: number; code: string; date: string; kind: "presidential" | "legislative"; body: string; title: string; status: string; total_seats: number | null; winner: string | null; wikipedia_url: string | null }>(sql`
    select id, country_code as code, date, kind, body, title, status, total_seats, winner, wikipedia_url from elections`);
  const res = await rows<{ election_id: number; party_label: string; partyfacts_id: number | null; candidate: string | null; seats: number | null; seats_before: number | null; vote_share: string | null; econ: string | null; score_source: string | null }>(sql`
    select election_id, party_label, partyfacts_id, candidate, seats, seats_before, vote_share, econ, score_source from election_results
    order by election_id, coalesce(seats, -1) desc, coalesce(vote_share, -1) desc, position`);

  const results = new Map<number, ElectionItem["results"]>();
  for (const r of res) {
    const list = results.get(r.election_id) ?? [];
    list.push({ party: r.party_label, partyfactsId: r.partyfacts_id, candidate: r.candidate, seats: r.seats, seatsBefore: r.seats_before, share: num(r.vote_share), econ: num(r.econ), scoreSource: r.score_source });
    results.set(r.election_id, list);
  }
  const byCountry = new Map<string, ElectionItem[]>();
  for (const e of els) {
    const code = e.code.trim();
    const list = byCountry.get(code) ?? [];
    list.push({ id: e.id, date: day(e.date)!, kind: e.kind, body: e.body, title: e.title, status: e.status, totalSeats: e.total_seats, turnout: null, econ: null, galtan: null, coverage: null, winner: e.winner, url: e.wikipedia_url, drift: null, results: results.get(e.id) ?? [] });
    byCountry.set(code, list);
  }

  const issues: AuditIssue[] = [];
  for (const c of countries) {
    const code = c.code.trim();
    const g = govs.find((x) => x.code.trim() === code);
    if (!g) continue;
    const input: AuditInput = {
      code,
      name: c.name,
      sovereign: c.sovereign,
      role: g.role,
      leader: { name: g.name, since: day(g.since), partyName: g.party_name, partyfactsId: g.party_pf },
      elections: byCountry.get(code) ?? [],
      nextElectionOn: day(g.next),
      econ: num(g.econ),
      galtan: num(g.galtan),
      today,
    };
    issues.push(...auditCountry(input));
  }

  const errors = issues.filter((i) => i.severity === "erro");
  const warnings = issues.filter((i) => i.severity === "aviso");
  const name = new Map(countries.map((c) => [c.code.trim(), c.name]));
  const line = (i: AuditIssue) => `- **${name.get(i.code) ?? i.code}** (${i.code}): ${i.message}`;
  const report = [
    `## Auditoria dos países — ${today}`,
    `${countries.length} países verificados · ${errors.length} erros · ${warnings.length} avisos`,
    errors.length ? `### Erros (o leitor vê algo errado)\n${errors.map(line).join("\n")}` : "Nenhum erro.",
    warnings.length ? `<details><summary>Avisos (${warnings.length})</summary>\n\n${warnings.map(line).join("\n")}\n</details>` : "",
  ].join("\n\n");
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`auditoria falhou: ${(err as Error).message}`);
  process.exit(0);
});
