import { Injectable } from '@nestjs/common';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
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
  channelReturnId: string;
  status: CustomerReturnStatus;
  reason: string;
  feeBearer: string;
  requestedBy: string;
  warehouseId: string | null;
  requestedAt: string;
  arrivedAt: string | null;
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
    quantity: number;
    /** 미도착으로 닫은 수량(N8) — 정산은 `quantity − missingQty` 만 싣는다 */
    missingQty: number;
    items: Array<{
      id: string;
      skuId: string;
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
      const [record] = await trx
        .select()
        .from(wmsTables.customerReturns)
        .where(eq(wmsTables.customerReturns.id, id))
        .limit(1);
      if (!record) throw new NotFoundError(`Customer return not found: ${id}`);

      const lines = await trx
        .select()
        .from(wmsTables.customerReturnLines)
        .where(eq(wmsTables.customerReturnLines.customerReturnId, id))
        .orderBy(asc(wmsTables.customerReturnLines.channelOrderItemId), asc(wmsTables.customerReturnLines.id));
      const items = await this.itemsOf(
        trx,
        lines.map((line) => line.id),
      );

      return {
        id: record.id,
        salesOrderId: record.salesOrderId,
        channelReturnId: record.channelReturnId,
        status: record.status,
        reason: record.reason,
        feeBearer: record.feeBearer,
        requestedBy: record.requestedBy,
        warehouseId: record.warehouseId,
        requestedAt: record.requestedAt.toISOString(),
        arrivedAt: record.arrivedAt?.toISOString() ?? null,
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
          quantity: line.quantity,
          missingQty: line.missingQty,
          items: items
            .filter((item) => item.customerReturnLineId === line.id)
            .map((item) => ({
              id: item.id,
              skuId: item.skuId,
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
        qtyPerUnit: i.qtyPerUnit,
        expectedQty: i.expectedQty,
        acceptedQty: i.acceptedQty,
        rejectedQty: i.rejectedQty,
        heldQty: i.heldQty,
      })
      .from(i)
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
