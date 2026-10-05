import { norm } from "./text";

// Statistical keyphrases from headlines: sequences of capitalised words (people,
// places, institutions) plus salient lowercase words. A baseline that works for
// every language we track; the local model adds conceptual themes on top.

const STOP = new Set(
  (
    "a o os as um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre entre e ou mas que se ao aos à às é foi ser são como mais menos já não sim seu sua seus suas ele ela eles elas isso esse essa este esta aquele pelo pela pelos pelas há tem têm vai vão quem onde quando porque " +
    "the a an of in on at to for with without by from and or but not is are was were be been being it its this that these those as about after before over under into than then so if how why what who when where will would can could should may might must new more most just also " +
    "el la los las un una unos unas del al y o pero que se es son fue ser como más menos ya no sí su sus por para con sin sobre entre cuando donde quien porque hay " +
    "le la les un une des du de et ou mais que qui ne pas est sont été être comme plus moins déjà son sa ses pour avec sans sur entre quand où pourquoi il elle ils elles ce cette " +
    "der die das ein eine und oder aber nicht ist sind war sein wie mehr weniger schon sein ihr für mit ohne über zwischen wenn wo warum er sie es dem den des im am zum zur auch noch nach vor bei aus von zu " +
    "il lo la i gli le un una di del della e o ma che non è sono come più meno per con senza su tra quando dove perché"
  ).split(" "),
);

export function keyphrases(title: string, max = 6): string[] {
  const clean = title.replace(/[“”"«»‘’]/g, " ").replace(/[|:–—!?¿¡()[\]]/g, " . ");
  const words = clean.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  // Proper-noun runs, skipping the very first word of the headline (always capitalised).
  let run: string[] = [];
  const flush = () => {
    if (run.length && !(run.length === 1 && STOP.has(norm(run[0])))) out.push(run.join(" ").replace(/[.,;]+$/, ""));
    run = [];
  };
  words.forEach((w, i) => {
    const bare = w.replace(/[.,;]+$/, "");
    const cap = /^\p{Lu}[\p{L}\-']+$/u.test(bare) && bare.length > 1;
    if (cap && i > 0 && run.length < 4) run.push(bare);
    else if (cap && i === 0 && !STOP.has(norm(bare)) && bare.length > 3) run.push(bare);
    else flush();
    if (/[.,;]$/.test(w)) flush();
  });
  flush();
  // Salient lowercase words (≥ 6 letters, not stopwords).
  for (const w of words) {
    const n = norm(w);
    if (n.length >= 6 && !STOP.has(n) && /^\p{Ll}/u.test(w)) out.push(n);
  }
  return [...new Set(out.map((p) => p.trim()).filter((p) => p.length >= 3))].slice(0, max);
}
