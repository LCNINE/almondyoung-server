import { Injectable } from '@nestjs/common';
import { asc, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { refundDueAt } from './customer-return-attention';
import type {
  CustomerReturnCsResolution,
  CustomerReturnPrepayment,
  CustomerReturnSettlement,
  CustomerReturnSettlementOutcome,
  CustomerReturnStatus,
} from './customer-return.types';

/** 반품 기록 한 건의 관리자·창고 화면 모양 (K8 PR6). 고객 개인정보는 싣지 않는다. */
export type CustomerReturnView = {
  id: string;
  salesOrderId: string;
  /** 주문 식별 — `orderNo` 는 고객이 아는 번호(없으면 채널 주문 id) (K8 PR7 N6) */
  order: { orderNo: string; channelOrderId: string; salesChannel: string };
  channelReturnId: string;
  status: CustomerReturnStatus;
  reason: string;
  feeBearer: string;
  requestedBy: string;
  warehouseId: string | null;
  windowOverrideReason: string | null;
  requestedAt: string;
  cancelledAt: string | null;
  arrivedAt: string | null;
  /** 환불 기한 — 첫 도착 전이면 null */
  refundDueAt: string | null;
  inspectedAt: string | null;
  settledAt: string | null;
  settlement: CustomerReturnSettlement | null;
  settlementOutcome: CustomerReturnSettlementOutcome | null;
  /** 선환불 진행과 결과(K8 PR6b) */
  prepayment: CustomerReturnPrepayment | null;
  /** CS 결정 — 미도착 닫기·보류 차감(K8 PR6b) */
  csResolution: CustomerReturnCsResolution | null;
  lines: Array<{
    id: string;
    salesOrderLineId: string;
    channelOrderItemId: string;
    productName: string;
    quantity: number;
    /** 미도착으로 닫은 수량(N8) — 정산은 `quantity − missingQty` 만 싣는다 */
    missingQty: number;
    items: Array<{
      id: string;
      skuId: string;
      skuName: string;
      skuCode: string;
      qtyPerUnit: number;
      expectedQty: number;
      /** 도착 기록 행의 합(N4) — 칸을 따로 두지 않는다 */
      arrivedQty: number;
      acceptedQty: number | null;
      rejectedQty: number | null;
      heldQty: number | null;
    }>;
  }>;
};

@Injectable()
export class CustomerReturnReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  async findById(id: string, tx?: DbTx): Promise<CustomerReturnView> {
    return this.dbService.run(async (trx) => {
      const [found] = await trx
        .select({
          record: getTableColumns(wmsTables.customerReturns),
          channelOrderId: wmsTables.salesOrders.channelOrderId,
          displayOrderNo: wmsTables.salesOrders.displayOrderNo,
          salesChannel: wmsTables.salesOrders.salesChannel,
        })
        .from(wmsTables.customerReturns)
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.customerReturns.salesOrderId))
        .where(eq(wmsTables.customerReturns.id, id))
        .limit(1);
      if (!found) throw new NotFoundError(`Customer return not found: ${id}`);
      const record = found.record;

      const lines = await trx
        .select({
          ...getTableColumns(wmsTables.customerReturnLines),
          productName: wmsTables.salesOrderLines.productName,
        })
        .from(wmsTables.customerReturnLines)
        .innerJoin(
          wmsTables.salesOrderLines,
          eq(wmsTables.salesOrderLines.id, wmsTables.customerReturnLines.salesOrderLineId),
        )
        .where(eq(wmsTables.customerReturnLines.customerReturnId, id))
        .orderBy(asc(wmsTables.customerReturnLines.channelOrderItemId), asc(wmsTables.customerReturnLines.id));
      const items = await this.itemsOf(
        trx,
        lines.map((line) => line.id),
      );

      return {
        id: record.id,
        salesOrderId: record.salesOrderId,
        order: {
          orderNo: found.displayOrderNo ?? found.channelOrderId,
          channelOrderId: found.channelOrderId,
          salesChannel: found.salesChannel,
        },
        channelReturnId: record.channelReturnId,
        status: record.status,
        reason: record.reason,
        feeBearer: record.feeBearer,
        requestedBy: record.requestedBy,
        warehouseId: record.warehouseId,
        windowOverrideReason: record.windowOverrideReason ?? null,
        requestedAt: record.requestedAt.toISOString(),
        cancelledAt: record.cancelledAt?.toISOString() ?? null,
        arrivedAt: record.arrivedAt?.toISOString() ?? null,
        refundDueAt: record.arrivedAt ? refundDueAt(record.arrivedAt).toISOString() : null,
        inspectedAt: record.inspectedAt?.toISOString() ?? null,
        settledAt: record.settledAt?.toISOString() ?? null,
        settlement: record.settlement ?? null,
        settlementOutcome: record.settlementOutcome ?? null,
        prepayment: record.prepayment ?? null,
        csResolution: record.csResolution ?? null,
        lines: lines.map((line) => ({
          id: line.id,
          salesOrderLineId: line.salesOrderLineId,
          channelOrderItemId: line.channelOrderItemId,
          productName: line.productName,
          quantity: line.quantity,
          missingQty: line.missingQty,
          items: items
            .filter((item) => item.customerReturnLineId === line.id)
            .map((item) => ({
              id: item.id,
              skuId: item.skuId,
              skuName: item.skuName,
              skuCode: item.skuCode,
              qtyPerUnit: item.qtyPerUnit,
              expectedQty: item.expectedQty,
              arrivedQty: item.arrivedQty,
              acceptedQty: item.acceptedQty,
              rejectedQty: item.rejectedQty,
              heldQty: item.heldQty,
            })),
        })),
      };
    }, tx);
  }

  /**
   * 반품 줄들의 SKU 항목과 항목마다 도착 합. 도착이 없으면 0.
   * 합은 따로 group by 로 읽는다 — 조인 없는 select 의 상관 서브쿼리는 drizzle 이 칼럼을 테이블 이름 없이 그려
   * 바깥 `id` 가 안쪽 테이블의 `id` 로 묶인다(`line-quantities.sql.ts` 의 함정).
   */
  private async itemsOf(trx: DbTx, lineIds: string[]) {
    if (lineIds.length === 0) return [];
    const i = wmsTables.customerReturnItems;
    const a = wmsTables.customerReturnArrivals;
    const items = await trx
      .select({
        id: i.id,
        customerReturnLineId: i.customerReturnLineId,
        skuId: i.skuId,
        skuName: wmsTables.skus.name,
        skuCode: wmsTables.skus.code,
        qtyPerUnit: i.qtyPerUnit,
        expectedQty: i.expectedQty,
        acceptedQty: i.acceptedQty,
        rejectedQty: i.rejectedQty,
        heldQty: i.heldQty,
      })
      .from(i)
      .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, i.skuId))
      .where(inArray(i.customerReturnLineId, lineIds))
      .orderBy(asc(i.skuId), asc(i.id));
    if (items.length === 0) return [];
    const arrived = await trx
      .select({ itemId: a.customerReturnItemId, qty: sql<number>`sum(${a.quantity})::int` })
      .from(a)
      .where(
        inArray(
          a.customerReturnItemId,
          items.map((item) => item.id),
        ),
      )
      .groupBy(a.customerReturnItemId);
    const arrivedByItem = new Map(arrived.map((row) => [row.itemId, row.qty]));
    return items.map((item) => ({ ...item, arrivedQty: arrivedByItem.get(item.id) ?? 0 }));
  }
}
