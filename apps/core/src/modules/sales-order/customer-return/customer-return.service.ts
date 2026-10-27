import { Injectable } from '@nestjs/common';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnRequestedPayload,
  ChannelReturnSettledPayload,
  ChannelReturnSettlementFailedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import {
  CustomerReturnReceivingManager,
  RecordCustomerReturnArrivalInput,
  RecordCustomerReturnInspectionInput,
} from './customer-return-receiving.manager';
import { CustomerReturnSettlementManager } from './customer-return-settlement.manager';
import {
  CloseCustomerReturnMissingInput,
  CustomerReturnCsManager,
  RequestCustomerReturnPrepayInput,
  SettleHeldCustomerReturnInput,
} from './customer-return-cs.manager';

@Injectable()
export class CustomerReturnService {
  constructor(
    private readonly manager: CustomerReturnManager,
    private readonly reader: CustomerReturnReader,
    private readonly receiving: CustomerReturnReceivingManager,
    private readonly settlement: CustomerReturnSettlementManager,
    private readonly cs: CustomerReturnCsManager,
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

  closeMissing(input: CloseCustomerReturnMissingInput, tx?: DbTx) {
    return this.cs.closeMissing(input, tx);
  }

  settleHeld(input: SettleHeldCustomerReturnInput, tx?: DbTx) {
    return this.cs.settleHeld(input, tx);
  }

  requestPrepay(input: RequestCustomerReturnPrepayInput, tx?: DbTx) {
    return this.cs.requestPrepay(input, tx);
  }

  recordSettled(fact: ChannelReturnSettledPayload, tx?: DbTx) {
    return this.settlement.recordSettled(fact, tx);
  }

  recordSettlementFailed(fact: ChannelReturnSettlementFailedPayload, tx?: DbTx) {
    return this.settlement.recordSettlementFailed(fact, tx);
  }

  reissueStalled(now: Date, tx?: DbTx) {
    return this.settlement.reissueStalled(now, tx);
  }
}
