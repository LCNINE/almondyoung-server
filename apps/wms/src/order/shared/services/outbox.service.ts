import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../../../database/schemas/wms-schema';


@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof wmsSchema>) { }

  async enqueue(params: { eventType: string; aggregateType: string; aggregateId: string; partitionKey: string; payload: unknown }, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      await trx.insert(wmsTables.outboxEvents).values({
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        status: 'pending',
      });
    };
    if (tx) return exec(tx);
    return this.db.db.transaction(exec);
  }
}


