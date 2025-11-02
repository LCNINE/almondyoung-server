import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema } from '../../../../database/schemas/wms-schema';
import { eq, and, lte, asc } from 'drizzle-orm';
import { StreamPublisher } from '@app/events';


@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  constructor(
    private readonly db: DbService<typeof wmsSchema>,
    private readonly publisher?: StreamPublisher<any>,
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
        await this.publisher?.publishEvent?.({
          eventType: ev.eventType as any,
          aggregateId: ev.aggregateId,
          payload: ev.payload as any,
          metadata: { partitionKey: ev.partitionKey }
        });
        await this.db.db.update(wmsTables.outboxEvents).set({ status: 'published', publishedAt: new Date(), attempts: ev.attempts + 1 }).where(eq(wmsTables.outboxEvents.id, ev.id));
      } catch (err) {
        this.logger.warn(`Failed to publish ${ev.id}: ${String(err)}`);
        const next = new Date(Date.now() + Math.min(60000, Math.pow(2, Math.min(6, ev.attempts)) * 1000));
        await this.db.db.update(wmsTables.outboxEvents).set({ status: 'pending', attempts: ev.attempts + 1, nextAttemptAt: next }).where(eq(wmsTables.outboxEvents.id, ev.id));
      }
    }
  }
}


