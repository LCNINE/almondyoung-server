import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { and, eq, isNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';

@Injectable()
export class DirectShipCancelNoticeReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 아직 업체에 알리지 않은 취소, 오래된 것부터. */
  async listOpen(filter: { companyName?: string }, tx?: DbTx): Promise<DirectShipCancelNotice[]> {
    return this.dbService.run(async (trx) => {
      const n = wmsTables.directShipCancelNotices;
      const where = [isNull(n.notifiedAt)];
      if (filter.companyName) where.push(eq(wmsTables.holders.name, filter.companyName));

      // 공급사SKU 가 여러 행이면 첫 행 — DISTINCT ON 은 정렬 첫 키가 n.id 여야 해서 순서는 아래에서 다시 맞춘다
      const rows = await trx
        .selectDistinctOn([n.id], {
          id: n.id,
          companyName: wmsTables.holders.name,
          salesOrderId: n.salesOrderId,
          channelOrderId: wmsTables.salesOrders.channelOrderId,
          salesOrderLineId: n.salesOrderLineId,
          fulfillmentOrderId: n.fulfillmentOrderId,
          skuName: wmsTables.skus.name,
          supplierSku: wmsTables.skuSuppliers.supplierSku,
          canceledQty: n.canceledQty,
          cancellationScope: n.cancellationScope,
          occurredAt: wmsTables.salesOrderCancellations.occurredAt,
          createdAt: n.createdAt,
          notifiedAt: n.notifiedAt,
          notifiedBy: n.notifiedBy,
        })
        .from(n)
        .innerJoin(wmsTables.holders, eq(wmsTables.holders.id, n.holderId))
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, n.salesOrderId))
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, n.skuId))
        .leftJoin(wmsTables.skuSuppliers, eq(wmsTables.skuSuppliers.skuId, n.skuId))
        .leftJoin(wmsTables.salesOrderCancellations, eq(wmsTables.salesOrderCancellations.id, n.orderCancellationId))
        .where(and(...where))
        .orderBy(n.id, wmsTables.skuSuppliers.createdAt);

      return rows
        .map(({ occurredAt, ...r }) => ({
          ...r,
          skuName: r.skuName ?? '',
          supplierSku: r.supplierSku ?? null,
          // FK 가 없어(N24) 취소 행이 없어도 대기 행이 사라지지 않게 대기 행 시각으로 받친다
          cancelledAt: occurredAt ?? r.createdAt,
        }))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    }, tx);
  }
}
