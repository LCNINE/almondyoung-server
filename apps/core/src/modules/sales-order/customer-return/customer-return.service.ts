import { Injectable } from '@nestjs/common';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import {
  CustomerReturnReceivingManager,
  RecordCustomerReturnArrivalInput,
  RecordCustomerReturnInspectionInput,
} from './customer-return-receiving.manager';

@Injectable()
export class CustomerReturnService {
  constructor(
    private readonly manager: CustomerReturnManager,
    private readonly reader: CustomerReturnReader,
    private readonly receiving: CustomerReturnReceivingManager,
  ) {}

  recordRequested(fact: ChannelReturnRequestedPayload, tx?: DbTx) {
    return this.manager.recordRequested(fact, tx);
  }

  recordCancelled(fact: ChannelReturnCancelledPayload, tx?: DbTx) {
    return this.manager.recordCancelled(fact, tx);
  }

  findById(id: string, tx?: DbTx) {
    return this.reader.findById(id, tx);
  }

  recordArrival(input: RecordCustomerReturnArrivalInput, tx?: DbTx) {
    return this.receiving.recordArrival(input, tx);
  }

  recordInspection(input: RecordCustomerReturnInspectionInput, tx?: DbTx) {
    return this.receiving.recordInspection(input, tx);
  }
}
