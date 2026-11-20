// Pure rules behind the "Governo em contexto" section of every country dossier, shared by
// the site (lib/knowledge.ts) and the hourly audit (scripts/audit-countries.ts), so what the
// page shows and what the audit checks can never drift apart. No database access here.

export type ElectionResultRow = { party: string; partyfactsId: number | null; candidate: string | null; seats: number | null; seatsBefore: number | null; share: number | null; econ: number | null; scoreSource: string | null };
export type ElectionItem = {
  id: number;
  date: string;
  kind: "presidential" | "legislative";
  body: string;
  title: string;
  status: string;
  totalSeats: number | null;
  turnout: number | null;
  econ: number | null;
  galtan: number | null;
  coverage: number | null;
  winner: string | null;
  url: string | null;
  drift: number | null;
  results: ElectionResultRow[];
};

export type Rise = { election: ElectionItem; opponent: ElectionResultRow | null; winnerRow: ElectionResultRow | null; matched: "candidate" | "legislative"; reelected?: boolean };
export type Strength = { seats: number; total: number; body: string; date: string; label: string };
export type Leader = { name: string | null; since: string | null; partyName: string | null; partyfactsId: number | null };

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Upper chambers: renewed partially or indirectly, never the governing majority. */
export const UPPER_CHAMBER = /senat|senado|upper|council of states|house of lords|bundesrat|house of councillors|rajya|seanad|national council of provinces/i;

/** "Workers' Party (Brazil)" → "Workers' Party": the country suffix English Wikipedia adds. */
export const partyLabel = (s: string) => s.replace(/\s*\([^)]*\)$/, "");

const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
/** Leader's surnames: every name token after the first, the last one first. */
const surnamesOf = (name: string | null) => {
  const t = name ? tokens(name) : [];
  return t.length > 1 ? [t[t.length - 1], ...t.slice(1, -1).reverse()] : t;
};
/**
 * Position of the leader among an election's candidates: by the last surname, else by
 * another surname ("Gustavo Petro Urrego" ran as "Gustavo Petro"). -1 when absent.
 */
function candidateIndex(e: ElectionItem, name: string | null): number {
  for (const surname of surnamesOf(name)) {
    const i = e.results.findIndex((r) => r.candidate && tokens(r.candidate).includes(surname));
    if (i >= 0) return i;
  }
  return -1;
}

/** Newest first; on a shared date the presidential vote, then the lower chamber, then the upper. */
export function sortElections(elections: ElectionItem[]): ElectionItem[] {
  return [...elections].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      Number(b.kind === "presidential") - Number(a.kind === "presidential") ||
      Number(UPPER_CHAMBER.test(a.body)) - Number(UPPER_CHAMBER.test(b.body)),
  );
}

/**
 * How the leader got there: the most recent election where they ran (top two), counting a
 * completed election after the mandate began that they won as a re-election; else the last
 * legislative vote before they took office.
 */
export function pickRise(elections: ElectionItem[], leader: Leader): Rise | null {
  const ordered = sortElections(elections);
  // Inaugurations happen a few days after the mandate's recorded start.
  const sinceLimit = leader.since ? new Date(new Date(leader.since).getTime() + 7 * 864e5).toISOString().slice(0, 10) : null;
  for (const e of ordered) {
    const i = candidateIndex(e, leader.name);
    if (i < 0) continue;
    const after = sinceLimit != null && e.date > sinceLimit;
    if (after ? i === 0 && e.status !== "ongoing" : i <= 1) {
      const others = e.results.filter((_, k) => k !== i);
      return { election: e, winnerRow: e.results[i], opponent: others[0] ?? null, matched: "candidate", reelected: after };
    }
  }
  if (leader.since) {
    const leg = ordered.find((e) => e.kind === "legislative" && e.date <= leader.since! && e.results.length && !UPPER_CHAMBER.test(e.body))
      ?? ordered.find((e) => e.kind === "legislative" && e.date <= leader.since! && e.results.length);
    if (leg) {
      const mine = leader.partyName ? leg.results.find((r) => fold(r.party).includes(fold(leader.partyName!).split(" (")[0])) : undefined;
      const rival = leg.results.find((r) => r !== mine);
      return { election: leg, winnerRow: mine ?? null, opponent: rival ?? null, matched: "legislative" };
    }
  }
  return null;
}

/** The ruling party's seats in the latest legislative result, lower chamber first. */
export function pickStrength(elections: ElectionItem[], leader: Leader): Strength | null {
  if (!leader.partyName) return null;
  const legs = sortElections(elections).filter((e) => e.kind === "legislative" && e.results.some((r) => r.seats != null));
  const ordered = [...legs.filter((e) => !UPPER_CHAMBER.test(e.body)), ...legs.filter((e) => UPPER_CHAMBER.test(e.body))];
  const key = fold(leader.partyName).split(" (")[0];
  for (const leg of ordered) {
    // Party Facts id first (also covers federations/alliances mapped to the lead party), then the name.
    const mine =
      (leader.partyfactsId ? leg.results.find((r) => r.partyfactsId === leader.partyfactsId) : undefined) ??
      leg.results.find((r) => fold(r.party).includes(key) || key.includes(fold(r.party)));
    const total = leg.totalSeats ?? leg.results.reduce((a, r) => a + (r.seats ?? 0), 0);
    if (mine?.seats != null && total) return { seats: mine.seats, total, body: leg.body, date: leg.date, label: partyLabel(mine.party) };
  }
  return null;
}

export const pickLatest = (elections: ElectionItem[]): ElectionItem | null => sortElections(elections)[0] ?? null;

// ── Audit ──────────────────────────────────────────────────────

export type AuditInput = {
  code: string;
  name: string;
  sovereign: boolean;
  role: string | null;
  leader: Leader;
  elections: ElectionItem[];
  nextElectionOn: string | null;
  econ: number | null;
  galtan: number | null;
  today: string;
};
export type AuditIssue = { code: string; severity: "erro" | "aviso"; message: string };

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

/** Inconsistencies a reader would see as wrong or outdated on the country page. */
export function auditCountry(c: AuditInput): AuditIssue[] {
  const out: AuditIssue[] = [];
  const add = (severity: AuditIssue["severity"], message: string) => out.push({ code: c.code, severity, message });
  const latest = pickLatest(c.elections);
  const rise = pickRise(c.elections, c.leader);
  const strength = pickStrength(c.elections, c.leader);

  for (const e of c.elections) {
    if (e.status === "ongoing" && days(e.date, c.today) > 45)
      add("erro", `${e.kind === "presidential" ? "Presidencial" : e.body} de ${e.date} ainda marcada como "em andamento" (${days(e.date, c.today)} dias)`);
    if (e.date > c.today && e.status === "held") add("erro", `${e.body} de ${e.date} marcada como realizada, mas a data é futura`);
    // Legislatures may add separate constituencies (Faroe Islands, minority seats); a presidential count may not.
    const shares = e.results.reduce((a, r) => a + (r.share ?? 0), 0);
    if (e.kind === "presidential" && shares > 105) add("erro", `Presidencial de ${e.date}: percentuais somam ${shares.toFixed(0)}%`);
    if (e.kind === "presidential" && !e.results.some((r) => r.candidate)) add("erro", `"Presidencial" de ${e.date} sem candidatos (provável quadro de votos de outro pleito)`);
    if (e.kind === "legislative" && /\d|\(|,| seats? /i.test(e.body)) add("aviso", `Nome de órgão com texto da infobox: "${e.body}"`);
    if (e.totalSeats && e.results.reduce((a, r) => a + (r.seats ?? 0), 0) > e.totalSeats * 1.02)
      add("aviso", `${e.body} de ${e.date}: mais cadeiras distribuídas do que o total (${e.totalSeats})`);
  }

  // A presidential vote won by someone else, long enough ago for the new president to be in office.
  const lastPres = sortElections(c.elections).find((e) => e.kind === "presidential" && e.status === "held" && e.results[0]?.candidate);
  if (c.role === "head_of_state" && lastPres && c.leader.name && days(lastPres.date, c.today) > 75 && (!c.leader.since || lastPres.date > c.leader.since)) {
    if (candidateIndex(lastPres, c.leader.name) !== 0)
      add("erro", `Governante pode estar desatualizado: ${lastPres.results[0].candidate} venceu a presidencial de ${lastPres.date}, mas o chefe registrado é ${c.leader.name}`);
  }

  if (rise?.matched === "candidate" && !rise.reelected) {
    const newer = sortElections(c.elections).find((e) => e.kind === rise.election.kind && e.date > rise.election.date && e.status === "held" && candidateIndex(e, c.leader.name) === 0);
    if (newer) add("erro", `"Como chegou lá" mostra ${rise.election.date}, mas ${c.leader.name} venceu de novo em ${newer.date}`);
  }
  if (strength && UPPER_CHAMBER.test(strength.body) && c.elections.some((e) => e.kind === "legislative" && !UPPER_CHAMBER.test(e.body) && e.date >= strength.date))
    add("erro", `"Força no legislativo" usa ${strength.body} embora haja eleição para a câmara baixa`);
  if (strength && strength.seats > strength.total) add("erro", `"Força no legislativo" com ${strength.seats}/${strength.total} cadeiras`);
  if (latest?.status === "ongoing" && latest.date < c.today && days(latest.date, c.today) <= 45)
    add("aviso", `Apuração de ${latest.date} ainda em andamento`);
  if (c.nextElectionOn && c.nextElectionOn < c.today) add("aviso", `"Próxima eleição" com data passada (${c.nextElectionOn})`);
  if (c.leader.since && c.leader.since > c.today) add("aviso", `Mandato com início no futuro (${c.leader.since})`);
  if (c.sovereign && c.econ == null && c.galtan == null) add("aviso", "Sem posição ideológica em nenhum eixo");
  return out;
}
