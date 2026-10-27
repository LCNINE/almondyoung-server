import { Injectable } from '@nestjs/common';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { CustomerReturnManager } from './customer-return.manager';

@Injectable()
export class CustomerReturnService {
  constructor(private readonly manager: CustomerReturnManager) {}

  recordRequested(fact: ChannelReturnRequestedPayload, tx?: DbTx) {
    return this.manager.recordRequested(fact, tx);
  }

  recordCancelled(fact: ChannelReturnCancelledPayload, tx?: DbTx) {
    return this.manager.recordCancelled(fact, tx);
  }
}
