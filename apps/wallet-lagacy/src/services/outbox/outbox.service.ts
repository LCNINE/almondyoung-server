import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { walletSchema } from '../../shared/database/schema';
import { WalletExecutor } from '../../shared/database';


@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof walletSchema>) { }

  async enqueue(params: { eventType: string; aggregateType: string; aggregateId: string; partitionKey: string; payload: unknown }, tx?: WalletExecutor) {
    const exec = async (trx: WalletExecutor) => {
      await trx.insert(walletSchema.outboxEvents).values({
        eventType: params.eventType,
        aggregateType: params.aggregateType,
        aggregateId: params.aggregateId,
        partitionKey: params.partitionKey,
        payload: params.payload as any,
        status: 'PENDING',
      });
    };
    if (tx) return exec(tx);
    return this.db.db.transaction(exec);
  }
}