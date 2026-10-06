import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

/** Small persisted cursors/flags for incremental jobs. */
export async function getState<T>(key: string, fallback: T): Promise<T> {
  const [r] = await db.select().from(schema.jobState).where(eq(schema.jobState.key, key));
  return (r?.value as T) ?? fallback;
}

export async function setState(key: string, value: unknown) {
  await db.insert(schema.jobState).values({ key, value }).onConflictDoUpdate({ target: schema.jobState.key, set: { value, updatedAt: new Date() } });
}
