import { asc, inArray } from 'drizzle-orm';
import { DbTx, Location, wmsTables } from '../../schema/inventory.schema';

/** Acquire only after all stock availability locks; hold until the caller commits. */
export async function lockWorkLocations(tx: DbTx, ids: string[]): Promise<Map<string, Location>> {
  const uniqueIds = [...new Set(ids)].sort();
  if (!uniqueIds.length) return new Map();
  const rows = await tx
    .select()
    .from(wmsTables.locations)
    .where(inArray(wmsTables.locations.id, uniqueIds))
    .orderBy(asc(wmsTables.locations.id))
    .for('share');
  return new Map(rows.map((row) => [row.id, row]));
}
