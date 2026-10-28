import { Injectable } from '@nestjs/common';
import type {
  ChannelReturnCancelledPayload,
  ChannelReturnPrepaidPayload,
  ChannelReturnPrepayFailedPayload,
  ChannelReturnRequestedPayload,
  ChannelReturnSettledPayload,
  ChannelReturnSettlementFailedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { DbTx } from '../../inventory/schema/inventory.schema';
import { CustomerReturnManager } from './customer-return.manager';
import { CustomerReturnReader } from './customer-return.reader';
import type { ListCustomerReturnsQueryDto } from './dto/list-customer-returns.dto';
import type { ListReceivingCustomerReturnsQueryDto } from './dto/list-receiving-customer-returns.dto';
import {
  CustomerReturnReceivingManager,
  RecordCustomerReturnArrivalInput,
  RecordCustomerReturnInspectionInput,
} from './customer-return-receiving.manager';
import { CustomerReturnSettlementManager, RestartCustomerReturnInput } from './customer-return-settlement.manager';
import { CustomerReturnPickupManager } from './customer-return-pickup.manager';
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
    private readonly pickups: CustomerReturnPickupManager,
  ) {}

  recordRequested(fact: ChannelReturnRequestedPayload, tx?: DbTx) {
    return this.manager.recordRequested(fact, tx);
  }

  recordCancelled(fact: ChannelReturnCancelledPayload, tx?: DbTx) {
    return this.manager.recordCancelled(fact, tx);
  }

  /** 반품 취소 전 한진 회수 놓아주기 (K8 PR9 N6) — 한진 HTTP 를 부르므로 트랜잭션을 받지 않는다 */
  releasePickup(channelReturnId: string) {
    return this.pickups.release(channelReturnId, new Date());
  }

  findById(id: string, tx?: DbTx) {
    return this.reader.findById(id, tx);
  }

  list(query: ListCustomerReturnsQueryDto, now: Date = new Date(), tx?: DbTx) {
    return this.reader.list(query, now, tx);
  }

  listForReceiving(query: ListReceivingCustomerReturnsQueryDto, tx?: DbTx) {
    return this.reader.listForReceiving(query, tx);
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

  recordPrepaid(fact: ChannelReturnPrepaidPayload, tx?: DbTx) {
    return this.settlement.recordPrepaid(fact, tx);
  }

  recordPrepayFailed(fact: ChannelReturnPrepayFailedPayload, tx?: DbTx) {
    return this.settlement.recordPrepayFailed(fact, tx);
  }

  restart(input: RestartCustomerReturnInput, tx?: DbTx) {
    return this.settlement.restart(input, tx);
  }

  reissueStalled(now: Date, tx?: DbTx) {
    return this.settlement.reissueStalled(now, tx);
  }
}
