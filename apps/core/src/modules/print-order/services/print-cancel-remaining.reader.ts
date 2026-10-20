import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { readLineQuantities } from '../../sales-order/line-quantities/line-quantities.reader';
import { type PrintSalesCancelTarget } from './print-order-admin.manager';

// 판매주문 취소 계획(planCancellation)과 같은 라인 수량 문(readLineQuantities)에서 남은 수량을 읽는다
@Injectable()
export class PrintCancelRemainingReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  remaining(target: PrintSalesCancelTarget): Promise<number> {
    return this.dbService.run(async (tx) => {
      const lineQuantities = await readLineQuantities(tx, target.salesOrderId);
      return Math.max(0, lineQuantities.get(target.salesOrderLineId)?.remaining ?? 0);
    });
  }
}
