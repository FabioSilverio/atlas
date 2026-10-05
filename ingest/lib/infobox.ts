// Minimal wikitext template parser for {{Infobox election}} / {{Infobox legislative election}}.
// Handles nested templates and links, and the `module = {{Infobox ... | embed = yes}}` pattern
// that articles use to stack the presidential and legislative results.

export type Template = { name: string; params: Record<string, string> };

/** Every {{Infobox election}} / {{Infobox legislative election}} in the text, including embedded modules. */
export function findElectionInfoboxes(wikitext: string): Template[] {
  const out: Template[] = [];
  const re = /\{\{\s*Infobox (legislative )?election\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wikitext))) {
    const end = matchingBraces(wikitext, m.index);
    if (end < 0) continue;
    out.push(parseTemplate(wikitext.slice(m.index, end)));
  }
  return out;
}

function matchingBraces(s: string, start: number): number {
  let depth = 0;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === "{" && s[i + 1] === "{") {
      depth++;
      i++;
    } else if (s[i] === "}" && s[i + 1] === "}") {
      depth--;
      i++;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Splits "{{Name | a = 1 | b = [[x|y]] }}" at top-level pipes. */
export function parseTemplate(t: string): Template {
  const inner = t.slice(2, -2);
  const parts: string[] = [];
  let depthT = 0;
  let depthL = 0;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === "{{" || two === "}}" || two === "[[" || two === "]]") {
      if (two === "{{") depthT++;
      else if (two === "}}") depthT--;
      else if (two === "[[") depthL++;
      else depthL--;
      cur += two;
      i++;
    } else if (inner[i] === "|" && depthT === 0 && depthL === 0) {
      parts.push(cur);
      cur = "";
    } else cur += inner[i];
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq < 0) continue;
    params[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
  }
  return { name: parts[0].trim(), params };
}

/** Plain text of a wikitext value: links → their label, templates and refs dropped. */
export function plain(v: string | undefined): string {
  if (!v) return "";
  let s = v.replace(/<ref[^>]*\/>/gi, "").replace(/<ref[\s\S]*?<\/ref>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/\{\{\s*(?:nowrap|small|nobr)\s*\|([^{}]*)\}\}/gi, "$1");
  for (let i = 0; i < 5 && /\{\{[^{}]*\}\}/.test(s); i++) s = s.replace(/\{\{[^{}]*\}\}/g, "");
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1").replace(/'''?/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  return s.replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Target article of the first wikilink, or the plain value (Infobox party params are often bare titles). */
export function linkTarget(v: string | undefined): string | null {
  if (!v) return null;
  const m = v.match(/\[\[([^|\]#]+)/);
  if (m) return m[1].trim();
  const p = plain(v);
  return p || null;
}

export const num = (v: string | undefined): number | null => {
  const p = plain(v).replace(/[,\s]/g, "").replace(/%$/, "");
  const m = p.match(/^-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** First date in an election_date value: "{{Start date|2022|10|2}}", "4 October 2026 (first round)", "October 4, 2026". */
export function firstDate(v: string | undefined): string | null {
  if (!v) return null;
  const tpl = v.match(/\{\{\s*(?:start date|date|dts)[^|}]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (tpl) return iso(+tpl[1], +tpl[2], +tpl[3]);
  const p = plain(v);
  const dmy = p.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dmy && MONTHS[dmy[2].toLowerCase()]) return iso(+dmy[3], MONTHS[dmy[2].toLowerCase()], +dmy[1]);
  const mdy = p.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdy && MONTHS[mdy[1].toLowerCase()]) return iso(+mdy[3], MONTHS[mdy[1].toLowerCase()], +mdy[2]);
  return null;
}
/** Second date in "4 October 2026 (first round)<br>25 October 2026 (second round)". */
export function runoffDate(v: string | undefined): string | null {
  if (!v || !/second round|runoff|run-off|2nd round/i.test(v)) return null;
  const parts = v.split(/<br\s*\/?>|\n|;/i);
  const second = parts.find((p) => /second round|runoff|run-off|2nd round/i.test(p));
  return second ? firstDate(second) : null;
}
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export type ParsedResult = { position: number; party: string | null; partyLabel: string; candidate: string | null; seats: number | null; seatsBefore: number | null; votes: number | null; share: number | null };
export type ParsedElection = {
  kind: "presidential" | "legislative";
  body: string;
  date: string | null;
  runoff: string | null;
  ongoing: boolean;
  totalSeats: number | null;
  winner: string | null;
  turnout: number | null;
  results: ParsedResult[];
};

/** Interprets one infobox module. Returns null when it carries no usable results. */
export function interpret(t: Template): ParsedElection | null {
  const p = t.params;
  const results: ParsedResult[] = [];
  for (let i = 1; i <= 40; i++) {
    const party = p[`party${i}`];
    const candidate = p[`candidate${i}`] ?? p[`leader${i}`];
    if (!party && !p[`candidate${i}`]) continue;
    // Seat counts are integers; some infoboxes put a vote share in last_election.
    const int = (v: string | undefined) => {
      const n = num(v);
      return n != null && Number.isInteger(n) && !/%/.test(v ?? "") ? n : null;
    };
    const seats = int(p[`seats${i}`] ?? p[`seats_after${i}`]);
    results.push({
      position: i,
      party: linkTarget(party),
      partyLabel: plain(party) || plain(p[`alliance${i}`]) || `#${i}`,
      candidate: candidate ? plain(candidate) : null,
      seats,
      seatsBefore: int(p[`last_election${i}`] ?? p[`seats_before${i}`]),
      votes: num(p[`popular_vote${i}`] ?? p[`votes${i}`]),
      share: num(p[`percentage${i}`] ?? p[`pv_pct${i}`]),
    });
  }
  if (!results.length) return null;
  const legislative = /legislative/i.test(t.name) || results.some((r) => r.seats != null);
  const seatsText = plain(p.seats_for_election);
  const bodyFromSeats = seatsText.match(/seats? (?:in|of) the (.+)$/i)?.[1];
  const name = plain(p.election_name);
  const body = legislative
    ? (bodyFromSeats ?? (name && !/^\d{4}/.test(name) ? name : "Legislativo")).replace(/^the /i, "")
    : "Presidente";
  if (legislative && !results.some((r) => r.seats != null || r.share != null)) return null;
  if (!legislative && !results.some((r) => r.share != null || r.votes != null)) return null;
  return {
    kind: legislative ? "legislative" : "presidential",
    body,
    date: firstDate(p.election_date),
    runoff: runoffDate(p.election_date),
    ongoing: /^yes$/i.test(plain(p.ongoing)),
    totalSeats: num(seatsText.match(/(\d[\d,]*) seats/)?.[1]) ?? null,
    winner: plain(p.after_election) || null,
    turnout: num(p.turnout),
    results,
  };
}
