import { Injectable } from '@nestjs/common';
import { InjectTypedDb } from '@app/db/decorators';
import { DbService } from '@app/db';
import { BadRequestError } from '@app/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { orderNoSql } from '../supplier-shipment/supplier-shipment-queue.reader';
import { DirectShipCancelNotice } from './direct-ship-cancel-notice.types';

@Injectable()
export class DirectShipCancelNoticeReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  /** 아직 입점사에 알리지 않은 취소, 오래된 것부터. 입점사는 id 로만 거른다(K3 PR6 N6). */
  async listOpen(filter: { supplierId?: string; noticeIds?: string[] }, tx?: DbTx): Promise<DirectShipCancelNotice[]> {
    return this.dbService.run(async (trx) => {
      const n = wmsTables.directShipCancelNotices;
      const where = [isNull(n.notifiedAt)];
      if (filter.supplierId) where.push(eq(n.supplierId, filter.supplierId));
      if (filter.noticeIds) where.push(inArray(n.id, filter.noticeIds));

      const rows = await trx
        .select({
          id: n.id,
          supplierId: wmsTables.suppliers.id,
          companyName: wmsTables.suppliers.name,
          salesOrderId: n.salesOrderId,
          orderNo: orderNoSql(),
          channelOrderId: wmsTables.salesOrders.channelOrderId,
          salesOrderLineId: n.salesOrderLineId,
          orderCancellationId: n.orderCancellationId,
          fulfillmentOrderId: n.fulfillmentOrderId,
          fulfillmentOrderItemId: n.fulfillmentOrderItemId,
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
        // 옛 holders 행(라이브 0, K3 PR6 Task 0)은 inner join 으로 빠진다 — holder 칸은 PR 8 이 걷는다
        .innerJoin(wmsTables.suppliers, eq(wmsTables.suppliers.id, n.supplierId))
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, n.salesOrderId))
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, n.skuId))
        // 그 입점사의 연결만 — 같은 SKU 의 다른 공급사 코드가 실리면 입점사가 못 찾는다(PK 가 (sku, supplier) 라 많아야 한 행)
        .leftJoin(
          wmsTables.skuSuppliers,
          and(eq(wmsTables.skuSuppliers.skuId, n.skuId), eq(wmsTables.skuSuppliers.supplierId, n.supplierId)),
        )
        .leftJoin(wmsTables.salesOrderCancellations, eq(wmsTables.salesOrderCancellations.id, n.orderCancellationId))
        .where(and(...where))
        .orderBy(asc(n.createdAt), asc(n.id));

      return rows.map(({ occurredAt, ...r }) => ({
        ...r,
        skuName: r.skuName ?? '',
        supplierSku: r.supplierSku ?? null,
        // FK 가 없어(N24) 취소 행이 없어도 대기 행이 사라지지 않게 대기 행 시각으로 받친다
        cancelledAt: occurredAt ?? r.createdAt,
      }));
    }, tx);
  }

  /** 고른 행만 — 전부 이 입점사의 아직 안 알린 취소여야 한다. 하나라도 아니면 던진다(알림 완료와 같은 규칙). */
  async listOpenSelected(supplierId: string, noticeIds: string[], tx?: DbTx): Promise<DirectShipCancelNotice[]> {
    const ids = [...new Set(noticeIds)];
    const rows = await this.listOpen({ supplierId, noticeIds: ids }, tx);
    if (rows.length !== ids.length) throw new BadRequestError('알림 대상이 이 업체의 알릴 취소가 아닙니다.');
    return rows;
  }
}
