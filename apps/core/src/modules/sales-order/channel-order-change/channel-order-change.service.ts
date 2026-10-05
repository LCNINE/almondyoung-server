import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import type { OrderModifiedPayload } from '@packages/event-contracts/streams';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { ChannelOrderChangeManager } from './channel-order-change.manager';

/** 수집 뒤 채널 변경을 판매주문에 반영한다(#1016 5번 행). */
@Injectable()
export class ChannelOrderChangeService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly db: DbService<typeof wmsSchema>,
    private readonly manager: ChannelOrderChangeManager,
  ) {}

  handle(salesOrderId: string, payload: OrderModifiedPayload, sourceEventId: string, tx?: DbTx): Promise<void> {
    return this.db.run((trx) => this.manager.handle(salesOrderId, payload, sourceEventId, trx), tx);
  }
}
