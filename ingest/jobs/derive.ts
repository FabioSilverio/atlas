import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";
import { deriveGovernmentPosition, type ScoreInput } from "@/lib/ideology/derive";
import type { Dimension } from "@/lib/ideology/normalize";
import type { Job } from "../lib/job";

const DIMENSIONS: Dimension[] = ["econ_lr", "galtan"];
const n = (v: string | null) => (v == null ? null : Number(v));

export const deriveJob: Job = {
  name: "derive",
  description: "posição de cada governo atual (hierarquia de fontes + confiança A–D)",
  async run() {
    const govs = await db.select().from(schema.governments).where(isNull(schema.governments.endedOn));
    const year = new Date().getFullYear();
    const stats: Record<string, number> = { governments: govs.length };

    for (const g of govs) {
      const chiefId = g.chiefExecutiveRole === "head_of_state" ? g.headOfStateId : g.headOfGovernmentId;
      const [chief] = chiefId ? await db.select().from(schema.people).where(eq(schema.people.id, chiefId)) : [];
      // Parties of the chief executive only (role 'leader'), most recent membership first.
      const leaders = await db
        .select({ id: schema.parties.id, name: schema.parties.name })
        .from(schema.governmentParties)
        .innerJoin(schema.parties, eq(schema.parties.id, schema.governmentParties.partyId))
        .where(and(eq(schema.governmentParties.governmentId, g.id), eq(schema.governmentParties.role, "leader")))
        .orderBy(schema.governmentParties.position);

      const conds = [];
      if (leaders.length) conds.push(inArray(schema.ideologyScores.partyId, leaders.map((p) => p.id)));
      if (chiefId) conds.push(eq(schema.ideologyScores.personId, chiefId));
      const raw = conds.length ? await db.select().from(schema.ideologyScores).where(or(...conds)) : [];
      const scores: ScoreInput[] = raw.map((s) => ({
        id: s.id,
        partyId: s.partyId,
        personId: s.personId,
        dimension: s.dimension as Dimension,
        valueNorm: Number(s.valueNorm),
        rawValue: n(s.rawValue),
        rawLabel: s.rawLabel,
        scaleMin: n(s.scaleMin),
        scaleMax: n(s.scaleMax),
        observedYear: s.observedYear,
        method: s.method as ScoreInput["method"],
        sourceId: s.sourceId ?? "",
        subjectName: s.subjectName,
        notes: s.notes,
      }));

      await db.delete(schema.governmentPositions).where(eq(schema.governmentPositions.governmentId, g.id));
      for (const dimension of DIMENSIONS) {
        const r = deriveGovernmentPosition({
          dimension,
          chiefPersonId: chiefId,
          chiefPersonName: chief?.name ?? null,
          chiefParties: leaders,
          scores,
          currentYear: year,
        });
        await db.insert(schema.governmentPositions).values({
          governmentId: g.id,
          dimension,
          valueNorm: r.valueNorm == null ? null : String(r.valueNorm),
          confidence: r.confidence,
          isEstimate: r.isEstimate,
          derivation: { ...r.derivation, chiefExecutiveRule: g.chiefExecutiveRule },
          computedAt: new Date(),
        });
        const key = `${dimension}_${r.confidence ?? "none"}`;
        stats[key] = (stats[key] ?? 0) + 1;
      }
    }
    return stats;
  },
};
