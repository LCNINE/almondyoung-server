import { Injectable } from '@nestjs/common';
import { InjectTypedDb, DbService } from '@app/db';
import { wmsSchema, DbTx } from '../../schema/inventory.schema';
import { WarehouseTransferManager, CreateTransferOrderInput, ReceiveTransferInput } from './warehouse-transfer.manager';
import { WarehouseTransferReader, OutstandingTransfer } from './warehouse-transfer.reader';

/** 이동 지시서 포트. 위임만 한다 — 검증·비즈니스 로직은 Manager/Reader 가 소유한다. */
@Injectable()
export class WarehouseTransferService {
  constructor(
    private readonly manager: WarehouseTransferManager,
    private readonly reader: WarehouseTransferReader,
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

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

  /**
   * Reader.findOutstanding 은 이미 열린 tx 를 요구한다(항상 자기 자신을 dbService.run
   * 으로 감싸는 패턴이라 non-optional). 여기서 트랜잭션을 열어 넘겨줌으로써
   * Controller 가 DbService 를 직접 주입받지 않아도 되게 한다.
   */
  findOutstanding(tx?: DbTx): Promise<OutstandingTransfer[]> {
    return this.dbService.run((trx) => this.reader.findOutstanding(trx), tx);
  }
}
