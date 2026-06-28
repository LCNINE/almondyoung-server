import { eq } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbTransaction } from '../../catalog.types';

export interface OrphanCleanupSpec {
  /** The owned entity table whose rows get deleted when unreferenced. */
  entityTable: PgTable;
  /** Primary-key column of `entityTable` (matched against each candidate id). */
  entityIdColumn: PgColumn;
  /** The version-junction table that references the entity. */
  junctionTable: PgTable;
  /** The column in `junctionTable` that points at `entityTable`'s id. */
  junctionFkColumn: PgColumn;
}

/**
 * 버전 격리에서 entity row 와 version mapping 을 분리한 뒤, 어떤 entity 를 가리키는
 * junction row 가 0개로 남으면 그 entity 를 삭제한다 (orphan 정리).
 *
 * variant·pricing rule·purchase constraint 가 각자 손구현하던 동일 프리미티브를 통일한 것.
 * 자세한 결정은 docs/adr/0026-version-cow-targeted-decomposition.md.
 *
 * @returns 삭제된 entity 수
 */
export async function deleteEntitiesIfUnmapped(
  tx: DbTransaction,
  spec: OrphanCleanupSpec,
  candidateIds: string[],
): Promise<number> {
  let deletedCount = 0;
  for (const id of new Set(candidateIds)) {
    const remaining = await tx
      .select({ ref: spec.junctionFkColumn })
      .from(spec.junctionTable)
      .where(eq(spec.junctionFkColumn, id));
    if (remaining.length === 0) {
      await tx.delete(spec.entityTable).where(eq(spec.entityIdColumn, id));
      deletedCount += 1;
    }
  }
  return deletedCount;
}
