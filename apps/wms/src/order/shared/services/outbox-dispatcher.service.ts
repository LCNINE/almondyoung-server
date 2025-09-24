import { Injectable, Logger } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { eq, and, lte, asc } from 'drizzle-orm';
import { EventPublisherService } from '@app/events';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0];

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly publisher?: EventPublisherService<any>,
  ) {}

  async dispatchBatch(limit = 100) {
    const now = new Date();
    const rows = await this.db.db.select()
      .from(wmsTables.outboxEvents)
      .where(and(
        eq(wmsTables.outboxEvents.status, 'pending'),
        lte(wmsTables.outboxEvents.nextAttemptAt, now)
      ))
      .orderBy(asc(wmsTables.outboxEvents.nextAttemptAt))
      .limit(limit);
    for (const ev of rows) {
      try {
        await this.publisher?.publishEvent?.(ev.eventType as any, ev.payload as any, { partitionKey: ev.partitionKey } as any);
        await this.db.db.update(wmsTables.outboxEvents).set({ status: 'published', publishedAt: new Date(), attempts: ev.attempts + 1 }).where(eq(wmsTables.outboxEvents.id, ev.id));
      } catch (err) {
        this.logger.warn(`Failed to publish ${ev.id}: ${String(err)}`);
        const next = new Date(Date.now() + Math.min(60000, Math.pow(2, Math.min(6, ev.attempts)) * 1000));
        await this.db.db.update(wmsTables.outboxEvents).set({ status: 'pending', attempts: ev.attempts + 1, nextAttemptAt: next }).where(eq(wmsTables.outboxEvents.id, ev.id));
      }
    }
  }
}


