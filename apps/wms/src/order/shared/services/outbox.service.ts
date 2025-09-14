import { Injectable } from '@nestjs/common';
import { DbService, TypedDatabase } from '@app/db';
import { wmsTables } from '../../../../database/schemas/wms-schema';

type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsTables>['transaction']>[0]>[0];

@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof wmsTables>) {}

  async enqueue(params: { eventType: string; aggregateType: string; aggregateId: string; partitionKey: string; payload: unknown }, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      await trx.insert(wmsTables.outboxEvents).values({
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        status: 'pending' as any,
      });
    };
    if (tx) return exec(tx);
    return this.db.db.transaction(exec);
  }
}


