export type Role = "head_of_state" | "head_of_government";

export type ChiefInput = {
  hosQid?: string | null;
  hogQid?: string | null;
  /** Herre (2023) / V-Dem coding for the latest year: is the head of government also the effective leader? */
  herreMatchHogLeader?: "yes" | "no" | "n/a" | null;
  herreYear?: number | null;
  /** Herre's title for the head of government that year ("President", "Prime Minister"…). */
  herreHogTitle?: string | null;
  override?: { role: Role; justification: string } | null;
};

/**
 * Decides whose position counts as "the government's".
 * Order: editorial override → same person → only one head known → Herre/V-Dem
 * coding of the effective leader → parliamentary default.
 */
export function chooseChiefExecutive(i: ChiefInput): { role: Role; rule: string } {
  if (i.override) return { role: i.override.role, rule: `Correção editorial: ${i.override.justification}` };
  if (i.hosQid && i.hosQid === i.hogQid)
    return { role: "head_of_state", rule: "Chefe de Estado e chefe de governo são a mesma pessoa." };
  if (!i.hogQid && i.hosQid)
    return { role: "head_of_state", rule: "Só há chefe de Estado registrado no Wikidata." };
  if (!i.hosQid && i.hogQid)
    return { role: "head_of_government", rule: "Só há chefe de governo registrado no Wikidata." };
  // Presidential systems: V-Dem/Herre record the president as head of government,
  // while Wikidata's P6 often holds a prime minister or a stale former president.
  if (i.herreMatchHogLeader === "yes" && /^President( |$)/.test(i.herreHogTitle ?? "") && i.hosQid)
    return {
      role: "head_of_state",
      rule: `Sistema presidencialista: Herre (2023), a partir do V-Dem, registra o presidente como chefe de governo (dado de ${i.herreYear ?? "2020"}).`,
    };
  if (i.herreMatchHogLeader === "no")
    return {
      role: "head_of_state",
      rule: `Herre (2023), a partir do V-Dem, identifica o chefe de Estado como líder efetivo do executivo (dado de ${i.herreYear ?? "2020"}).`,
    };
  if (i.herreMatchHogLeader === "yes")
    return {
      role: "head_of_government",
      rule: `Herre (2023), a partir do V-Dem, identifica o chefe de governo como líder efetivo do executivo (dado de ${i.herreYear ?? "2020"}).`,
    };
  return {
    role: "head_of_government",
    rule: "Regra padrão: na ausência de codificação acadêmica, o chefe de governo é tratado como chefe do executivo.",
  };
}
