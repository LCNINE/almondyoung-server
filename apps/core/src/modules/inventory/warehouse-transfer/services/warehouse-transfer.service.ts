import { Injectable } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import {
  WarehouseTransferManager,
  CreateTransferOrderInput,
  ReceiveTransferInput,
} from './warehouse-transfer.manager';

/** 이동 지시서 포트. 위임만 한다 — 검증·비즈니스 로직은 Manager 가 소유한다. */
@Injectable()
export class WarehouseTransferService {
  constructor(private readonly manager: WarehouseTransferManager) {}

  createOrder(input: CreateTransferOrderInput, tx?: DbTx) {
    return this.manager.createOrder(input, tx);
  }

  ship(input: { transferOrderId: string; idempotencyKey: string; actorId?: string }, tx?: DbTx) {
    return this.manager.ship(input, tx);
  }

  receive(input: ReceiveTransferInput, tx?: DbTx) {
    return this.manager.receive(input, tx);
  }

  updateEta(input: { transferOrderId: string; eta: Date }, tx?: DbTx) {
    return this.manager.updateEta(input, tx);
  }
}
