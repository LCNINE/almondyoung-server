import { productAuditLog } from '../../../schema/catalog.schema';
import { DbTransaction } from '../../../catalog.types';

export type ProductAuditAction =
  | 'created'
  | 'updated'
  | 'published'
  | 'rolled_back'
  | 'unpublished'
  | 'exposure_updated'
  | 'deleted'
  | 'restored'
  | 'hard_deleted'
  | 'master_deleted'
  | 'master_restored'
  | 'bulk_updated';

export type AuditChanges = Record<string, { old: unknown; new: unknown }>;

export async function recordProductAudit(
  tx: DbTransaction,
  entry: {
    masterId: string;
    versionId: string | null;
    action: ProductAuditAction;
    userId: string;
    changes?: AuditChanges;
  },
): Promise<void> {
  await tx.insert(productAuditLog).values({ ...entry, changes: entry.changes ?? {} });
}

export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): AuditChanges {
  const changes: AuditChanges = {};
  for (const [key, value] of Object.entries(after)) {
    if (value === undefined) continue;
    if (JSON.stringify(before[key] ?? null) === JSON.stringify(value)) continue;
    changes[key] = { old: before[key] ?? null, new: value };
  }
  return changes;
}
