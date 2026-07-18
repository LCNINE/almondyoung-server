import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import type { ChannelAdapterSchema } from '../types';

/**
 * Serializes every Medusa order metadata read-modify-write across worker types
 * and service replicas. Keep the lock identity and acquisition order centralized:
 * one order lock, followed by the external GET/POST projection work.
 */
export async function withMedusaOrderProjectionLock<T>(
  dbService: DbService<ChannelAdapterSchema>,
  orderId: string,
  work: () => Promise<T>,
): Promise<T> {
  return dbService.db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${orderId}, 0))`);
    return work();
  });
}
