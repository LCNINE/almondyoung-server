import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../../sales-order/services/sales-orders.service';
import { type PrintSalesCancelTarget } from './print-order-admin.manager';

// 판매주문 취소 계획(planCancellation)과 같은 «이미 취소된 수량» 계산을 써서 남은 수량을 구한다
@Injectable()
export class PrintCancelRemainingReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
    private readonly salesOrders: SalesOrdersService,
  ) {}

  remaining(target: PrintSalesCancelTarget): Promise<number> {
    return this.dbService.run(async (tx) => {
      const cancelled = await this.salesOrders.getCancelledQuantityByLine(target.salesOrderId, tx);
      return Math.max(0, target.lineQuantity - (cancelled.get(target.salesOrderLineId) ?? 0));
    });
  }
}
