// Who counts as an "intellectual" in the government-context lists, judged only
// from Wikidata occupation labels (English). Returns 0 to exclude, otherwise a
// rank used before notability, so a celebrity never outranks a scholar.

/** Scholarly occupations: the strongest signal. */
const ACADEMIC = /\b(philosopher|economist|political scientist|sociologist|historian|theologian|political theorist|anthropologist|legal scholar|political philosopher|social scientist|demographer|geographer|psychologist|linguist)\b/i;

/** People whose work is the political debate itself. */
const POLITICAL_MEDIA = /\b(political (commentator|pundit|analyst|writer|strategist|activist|journalist)|columnist|opinion journalist|ideologue|essayist|public intellectual|polemicist|propagandist|think tank|editor-in-chief|pundit)\b/i;

/** Generic writing/academic roles: the weakest signal. */
const GENERIC = /\b(writer|author|novelist|journalist|blogger|podcaster|academic|university teacher|professor|commentator|activist|radio personality)\b/i;

/** Career politicians and office-holders. */
const POLITICIAN = /\b(politician|legislator|diplomat|head of state|minister|mayor|president|judge|jurist|magistrate|military officer|statesperson)\b/i;

/** What a politician must also be to count: someone who produces doctrine, not policy. */
const DOCTRINE = /\b(philosopher|political theorist|political philosopher|ideologue|political commentator|political pundit|polemicist)\b/i;

/** Sport and entertainment: excluded unless outweighed by scholarly occupations. */
const CELEBRITY = /\b(football|soccer|player|athlete|coach|sports?|actor|actress|singer|musician|rapper|comedian|performing artist|model|socialite|celebrity|influencer|youtuber|wrestler|wrestling|ring announcer|booker|boxer|fencer|cyclist|swimmer|racing|tennis|golfer|skier|dancer|film producer|film director|screenwriter|television personality|reality|chef|beauty pageant|astronaut)\b/i;

export function intellectualRank(occupations: string[]): number {
  const count = (re: RegExp) => occupations.filter((o) => re.test(o)).length;
  const academic = count(ACADEMIC);
  const celebrity = count(CELEBRITY);
  // A footballer-turned-pundit or a model with a sociology degree is not an intellectual.
  if (celebrity > 0 && celebrity >= academic) return 0;
  // Office-holders are the government itself, not its thinkers, even with an
  // economics degree; only those whose work is doctrine stay (and rank as pundits).
  if (count(POLITICIAN) > 0) return count(DOCTRINE) > 0 ? 2 : 0;
  if (academic > 0) return 3;
  if (count(POLITICAL_MEDIA) > 0) return 2;
  if (count(GENERIC) > 0) return 1;
  return 0;
}
