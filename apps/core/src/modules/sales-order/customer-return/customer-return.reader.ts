import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, notInArray, or, sql, SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CustomerReturnAttention, customerReturnAttention, refundDueAt } from './customer-return-attention';
import type { ListCustomerReturnsQueryDto } from './dto/list-customer-returns.dto';
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

/** 반품 목록 한 행 (K8 PR7 N2). `customerName` 은 개인정보 — 라우트의 `@PiiResponse` 가 가린다. */
export type CustomerReturnListItem = {
  id: string;
  salesOrderId: string;
  orderNo: string;
  channelOrderId: string;
  customerName: string | null;
  status: CustomerReturnStatus;
  reason: string;
  feeBearer: string;
  requestedBy: string;
  requestedAt: string;
  arrivedAt: string | null;
  refundDueAt: string | null;
  settledAt: string | null;
  cancelledAt: string | null;
  /** 반품 줄 수량의 합 */
  quantity: number;
  /** 첫 줄 품목명, 줄이 더 있으면 «외 N건» */
  productSummary: string;
  refundAmount: number | null;
  attention: CustomerReturnAttention[];
};

export type CustomerReturnListPage = {
  items: CustomerReturnListItem[];
  total: number;
  /** 진행 중 전체에서 센 확인 필요 반품 수 — bucket·q 와 무관 */
  attentionCount: number;
};

/** 진행 중 반품을 전부 읽는다(N2). 공정이 묶는 수라 자르지 않고, 이 수를 넘으면 경고만 남긴다. */
const OPEN_WARN_THRESHOLD = 500;
const CLOSED_STATUSES: CustomerReturnStatus[] = ['settled', 'cancelled'];

@Injectable()
export class CustomerReturnReader {
  private readonly logger = new Logger(CustomerReturnReader.name);

  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  /**
   * 반품 목록. open·attention 은 진행 중 반품을 전부 읽어 TS 로 판정·정렬한 뒤 자르고,
   * closed 는 SQL 페이지다(N2).
   */
  async list(query: ListCustomerReturnsQueryDto, now: Date, tx?: DbTx): Promise<CustomerReturnListPage> {
    return this.dbService.run(async (trx) => {
      const r = wmsTables.customerReturns;
      const base = () =>
        trx
          .select({
            record: getTableColumns(r),
            channelOrderId: wmsTables.salesOrders.channelOrderId,
            displayOrderNo: wmsTables.salesOrders.displayOrderNo,
            customerName: wmsTables.salesOrders.customerName,
          })
          .from(r)
          .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, r.salesOrderId));

      const openRows = await base().where(notInArray(r.status, CLOSED_STATUSES));
      if (openRows.length > OPEN_WARN_THRESHOLD) {
        this.logger.warn(`진행 중 반품 ${openRows.length}건 — 목록이 전부 읽는다(${OPEN_WARN_THRESHOLD} 초과)`);
      }
      const openItems = await this.decorate(trx, openRows, now);
      const attentionCount = openItems.filter((item) => item.attention.length > 0).length;

      if (query.bucket === 'closed') {
        const search = this.searchCondition(query.q);
        const where = and(inArray(r.status, CLOSED_STATUSES), search);
        const [{ total }] = await trx
          .select({ total: count() })
          .from(r)
          .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, r.salesOrderId))
          .where(where);
        const rows = await base()
          .where(where)
          .orderBy(desc(sql`coalesce(${r.settledAt}, ${r.cancelledAt}, ${r.updatedAt})`), desc(r.id))
          .limit(query.limit)
          .offset(query.offset);
        return { items: await this.decorate(trx, rows, now), total, attentionCount };
      }

      const needle = query.q?.trim();
      const matches = (item: CustomerReturnListItem) =>
        !needle ||
        item.orderNo === needle ||
        item.channelOrderId === needle ||
        (item.customerName ?? '').toLowerCase().includes(needle.toLowerCase());
      const pool = openItems
        .filter((item) => (query.bucket === 'attention' ? item.attention.length > 0 : true))
        .filter(matches)
        .sort((x, y) => {
          const dx = x.refundDueAt ? Date.parse(x.refundDueAt) : Number.POSITIVE_INFINITY;
          const dy = y.refundDueAt ? Date.parse(y.refundDueAt) : Number.POSITIVE_INFINITY;
          if (dx !== dy) return dx < dy ? -1 : 1;
          return Date.parse(x.requestedAt) - Date.parse(y.requestedAt);
        });
      return { items: pool.slice(query.offset, query.offset + query.limit), total: pool.length, attentionCount };
    }, tx);
  }

  /** q: 주문번호·채널 주문 id 정확 일치, 고객명 부분 일치(LIKE 메타문자는 문자 그대로) */
  private searchCondition(q?: string): SQL | undefined {
    const needle = q?.trim();
    if (!needle) return undefined;
    const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    return or(
      eq(wmsTables.salesOrders.displayOrderNo, needle),
      eq(wmsTables.salesOrders.channelOrderId, needle),
      ilike(wmsTables.salesOrders.customerName, `%${escaped}%`),
    );
  }

  /** 목록 행들에 줄 요약·수량 합·확인 필요를 붙인다. 합은 반품 id 로 group by 해 따로 읽는다. */
  private async decorate(
    trx: DbTx,
    rows: Array<{
      record: typeof wmsTables.customerReturns.$inferSelect;
      channelOrderId: string;
      displayOrderNo: string | null;
      customerName: string | null;
    }>,
    now: Date,
  ): Promise<CustomerReturnListItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.record.id);
    const l = wmsTables.customerReturnLines;
    const i = wmsTables.customerReturnItems;
    const a = wmsTables.customerReturnArrivals;

    const lines = await trx
      .select({
        customerReturnId: l.customerReturnId,
        quantity: l.quantity,
        missingQty: l.missingQty,
        productName: wmsTables.salesOrderLines.productName,
      })
      .from(l)
      .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.id, l.salesOrderLineId))
      .where(inArray(l.customerReturnId, ids))
      .orderBy(asc(l.channelOrderItemId), asc(l.id));
    const expected = await trx
      .select({ customerReturnId: l.customerReturnId, qty: sql<number>`sum(${i.expectedQty})::int` })
      .from(i)
      .innerJoin(l, eq(l.id, i.customerReturnLineId))
      .where(inArray(l.customerReturnId, ids))
      .groupBy(l.customerReturnId);
    const arrived = await trx
      .select({ customerReturnId: l.customerReturnId, qty: sql<number>`sum(${a.quantity})::int` })
      .from(a)
      .innerJoin(i, eq(i.id, a.customerReturnItemId))
      .innerJoin(l, eq(l.id, i.customerReturnLineId))
      .where(inArray(l.customerReturnId, ids))
      .groupBy(l.customerReturnId);
    const expectedBy = new Map(expected.map((row) => [row.customerReturnId, row.qty]));
    const arrivedBy = new Map(arrived.map((row) => [row.customerReturnId, row.qty]));

    return rows.map(({ record, channelOrderId, displayOrderNo, customerName }) => {
      const mine = lines.filter((line) => line.customerReturnId === record.id);
      const quantity = mine.reduce((sum, line) => sum + line.quantity, 0);
      const missingQty = mine.reduce((sum, line) => sum + line.missingQty, 0);
      const first = mine[0]?.productName ?? '';
      return {
        id: record.id,
        salesOrderId: record.salesOrderId,
        orderNo: displayOrderNo ?? channelOrderId,
        channelOrderId,
        customerName,
        status: record.status,
        reason: record.reason,
        feeBearer: record.feeBearer,
        requestedBy: record.requestedBy,
        requestedAt: record.requestedAt.toISOString(),
        arrivedAt: record.arrivedAt?.toISOString() ?? null,
        refundDueAt: record.arrivedAt ? refundDueAt(record.arrivedAt).toISOString() : null,
        settledAt: record.settledAt?.toISOString() ?? null,
        cancelledAt: record.cancelledAt?.toISOString() ?? null,
        quantity,
        productSummary: mine.length > 1 ? `${first} 외 ${mine.length - 1}건` : first,
        refundAmount: record.settlementOutcome?.refundAmount ?? null,
        attention: customerReturnAttention(
          {
            status: record.status,
            arrivedAt: record.arrivedAt,
            settlementState: record.settlement?.state ?? null,
            prepaymentState: record.prepayment?.state ?? null,
            expectedQty: expectedBy.get(record.id) ?? 0,
            arrivedQty: arrivedBy.get(record.id) ?? 0,
            missingQty,
          },
          now,
        ),
      };
    });
  }

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
