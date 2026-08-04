import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { analyticsSchema, aggCustomerLifetime } from '../../../schema';
import { DbTx } from '../../../db.types';
import { CustomerLifetimeSeed } from '../facts/order-types';

@Injectable()
export class CustomerLifetimeService {
  constructor(
    @InjectTypedDb<typeof analyticsSchema>()
    private readonly dbService: DbService<typeof analyticsSchema>,
  ) {}

  async applyOrderCreated(seed: CustomerLifetimeSeed, tx?: DbTx): Promise<void> {
    await this.dbService.run(async (trx) => {
      const now = new Date();
      // NOTE: seed.occurredAt is stringified via toISOString() before entering the raw
      // `sql` fragment below. Binding a JS Date directly into a raw sql template bypasses
      // drizzle's column-level mapToDriverValue serializer (postgres-js swaps in a
      // transparentParser for timestamp OIDs), which throws at runtime:
      // `TypeError: The "string" argument must be of type string or an instance of Buffer
      // or ArrayBuffer. Received an instance of Date`. See
      // apps/notification/src/shared/services/metrics.service.ts:54 for the live,
      // unfixed instance of this bug elsewhere in the repo. The .values({...}) call below
      // is unaffected since it goes through the typed builder, which serializes Date
      // correctly via the column's own mapper.
      const occurredAtIso = seed.occurredAt.toISOString();
      await trx
        .insert(aggCustomerLifetime)
        .values({
          customerId: seed.customerId,
          firstOrderAt: seed.occurredAt,
          lastOrderAt: seed.occurredAt,
          ordersCount: 1,
          totalRevenue: seed.revenue,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: aggCustomerLifetime.customerId,
          set: {
            firstOrderAt: sql`LEAST(${aggCustomerLifetime.firstOrderAt}, ${occurredAtIso}::timestamp)`,
            lastOrderAt: sql`GREATEST(${aggCustomerLifetime.lastOrderAt}, ${occurredAtIso}::timestamp)`,
            ordersCount: sql`${aggCustomerLifetime.ordersCount} + 1`,
            totalRevenue: sql`${aggCustomerLifetime.totalRevenue} + ${seed.revenue}`,
            updatedAt: now,
          },
        });
    }, tx);
  }
}
