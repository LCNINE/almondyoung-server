import { Injectable } from '@nestjs/common';
import { SalesOrderLookupReader } from './sales-order-lookup.reader';
import type { LookupSalesChannel, SalesOrderLookupItemDto, SalesOrderLookupResult } from './sales-order-lookup.dto';

@Injectable()
export class SalesOrderLookupService {
  constructor(private readonly reader: SalesOrderLookupReader) {}

  async lookup(channel: LookupSalesChannel, orders: SalesOrderLookupItemDto[]): Promise<SalesOrderLookupResult[]> {
    const [statuses, failing] = await Promise.all([
      this.reader.statusesByChannelOrderId(
        channel,
        orders.map((order) => order.externalOrderId),
      ),
      this.reader.wmsOrderIdsWithOpenEventFailure(orders.flatMap((order) => (order.wmsOrderId ? [order.wmsOrderId] : []))),
    ]);
    return orders.map((order) => {
      const status = statuses.get(order.externalOrderId);
      return {
        externalOrderId: order.externalOrderId,
        salesOrder: status === undefined ? null : { status },
        openEventFailure: order.wmsOrderId ? failing.has(order.wmsOrderId) : false,
      };
    });
  }
}
