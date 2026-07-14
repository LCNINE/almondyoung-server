import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../inventory/schema/inventory.schema';
import { and, eq } from 'drizzle-orm';

type OutboxEnqueueParams = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey: string;
  payload: unknown;
} & (
  | { topic: string; idempotencyKey: string }
  | {
      /** @deprecated Topicless writes are V1 expand compatibility only; remove in Task 25. */
      topic?: undefined;
      idempotencyKey?: undefined;
    }
);

@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof wmsSchema>) {}

  async enqueue(params: OutboxEnqueueParams, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      const [inserted] = await trx
        .insert(wmsTables.outboxEvents)
        .values({
          topic: params.topic,
          idempotencyKey: params.idempotencyKey,
          eventType: params.eventType,
          aggregateType: params.aggregateType,
          aggregateId: params.aggregateId,
          partitionKey: params.partitionKey,
          payload: params.payload as any,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning();

      if (inserted || !params.topic || !params.idempotencyKey) return inserted;

      const [existing] = await trx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, params.topic),
            eq(wmsTables.outboxEvents.eventType, params.eventType),
            eq(wmsTables.outboxEvents.idempotencyKey, params.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error('Outbox idempotency conflict did not resolve to an existing row');
      }
      return existing;
    };
    if (tx) return exec(tx);
    return this.db.db.transaction(exec);
  }
}
