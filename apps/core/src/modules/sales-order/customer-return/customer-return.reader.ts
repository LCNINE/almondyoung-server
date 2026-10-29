import { Injectable, Logger } from '@nestjs/common';
import { and, asc, count, desc, eq, getTableColumns, ilike, inArray, notInArray, or, sql, SQL } from 'drizzle-orm';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { NotFoundError } from '@app/shared';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CustomerReturnAttention, customerReturnAttention, refundDueAt } from './customer-return-attention';
import type { ListCustomerReturnsQueryDto } from './dto/list-customer-returns.dto';
import type { ListReceivingCustomerReturnsQueryDto } from './dto/list-receiving-customer-returns.dto';
import { maskName } from '../../fulfillment/reader/recipient-snapshot';
import { deliveredParcelsSql } from '../line-quantities/line-quantities.sql';
import type { CustomerReturnPickupStatus } from './customer-return-pickup.types';
import type {
  CustomerReturnCsResolution,
  CustomerReturnKind,
  CustomerReturnPrepayment,
  CustomerReturnSettlement,
  CustomerReturnSettlementOutcome,
  CustomerReturnStatus,
} from './customer-return.types';

/** 반품의 마지막 회수 행 (K8 PR9) — 시각은 ISO 문자열. 한진 응답 본문은 싣지 않는다(`lastError` 는 코드 요약뿐). */
export type CustomerReturnPickupView = {
  status: CustomerReturnPickupStatus;
  waybillNo: string | null;
  originalWaybillNo: string | null;
  lastError: string | null;
  attempts: number;
  reservedAt: string | null;
  pickedUpAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
};

/** 관리자·창고 반품 상세. 자유문구 메모에는 고객 개인정보가 포함될 수 있다. */
export type CustomerReturnView = {
  id: string;
  salesOrderId: string;
  /** 주문 식별 — `orderNo` 는 고객이 아는 번호(없으면 채널 주문 id) (K8 PR7 N6) */
  order: { orderNo: string; channelOrderId: string; salesChannel: string };
  channelReturnId: string;
  status: CustomerReturnStatus;
  /** 반품인지 교환인지 (K8 PR11) */
  kind: CustomerReturnKind;
  /** 교환 상자를 연 시각 — 열기 전·반품이면 null (K8 PR11) */
  exchangeReleasedAt: string | null;
  reason: string;
  note: string | null;
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
  /** 처음 검수한 사람의 id — 검수 전이면 null (K8 PR7b N9) */
  inspectedBy: string | null;
  settledAt: string | null;
  settlement: CustomerReturnSettlement | null;
  settlementOutcome: CustomerReturnSettlementOutcome | null;
  /** 선환불 진행과 결과(K8 PR6b) */
  prepayment: CustomerReturnPrepayment | null;
  /** 마지막 회수 행 — 한 번도 접수된 적 없으면 null (K8 PR9) */
  pickup: CustomerReturnPickupView | null;
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
      /** SKU 바코드 — 주 바코드 먼저, 그다음 바코드 오름차순 (K8 PR7b N5) */
      barcodes: string[];
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
  /** 마지막 회수 행의 회수 운송장번호 (K8 PR9) */
  pickupWaybillNo: string | null;
  attention: CustomerReturnAttention[];
};

export type CustomerReturnListPage = {
  items: CustomerReturnListItem[];
  total: number;
  /** 진행 중 전체에서 센 확인 필요 반품 수 — bucket·q 와 무관 */
  attentionCount: number;
};

/** 창고 도착 대기 목록의 단계 (K8 PR7b N3) — awaiting: 도착 전, partial: 덜 옴, ready: 검수 대기 */
export type CustomerReturnReceivingStage = 'awaiting' | 'partial' | 'ready';

/** 창고 도착 대기 목록 한 행 (K8 PR7b N3). 고객명은 가려서만 싣는다(N4) — 원문이 아니라 `@PiiResponse` 대상이 아니다. */
export type CustomerReturnReceivingItem = {
  id: string;
  orderNo: string;
  customerMasked: string;
  reason: string;
  productSummary: string;
  /** SKU 항목 기대 수량의 합 */
  expectedQty: number;
  /** SKU 항목 도착 수량의 합 */
  arrivedQty: number;
  stage: CustomerReturnReceivingStage;
  requestedAt: string;
};

/** 반품 한 건의 줄 요약과 수량 합 — 목록 둘(CS·창고)이 같이 쓴다 */
type CustomerReturnSummary = {
  quantity: number;
  missingQty: number;
  productSummary: string;
  expectedQty: number;
  arrivedQty: number;
};

const RECEIVING_STAGE_ORDER: Record<CustomerReturnReceivingStage, number> = { ready: 0, partial: 1, awaiting: 2 };

/** 진행 중 반품을 전부 읽는다(N2). 공정이 묶는 수라 자르지 않고, 이 수를 넘으면 경고만 남긴다. */
const OPEN_WARN_THRESHOLD = 500;
const CLOSED_STATUSES: CustomerReturnStatus[] = ['settled', 'cancelled'];

function pickupView(row: typeof wmsTables.customerReturnPickups.$inferSelect): CustomerReturnPickupView {
  return {
    status: row.status,
    waybillNo: row.waybillNo,
    originalWaybillNo: row.originalWaybillNo,
    lastError: row.lastError,
    attempts: row.attempts,
    reservedAt: row.reservedAt?.toISOString() ?? null,
    pickedUpAt: row.pickedUpAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

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
        const search = this.searchCondition(trx, query.q);
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
      // 회수 운송장은 끝난 행(취소된 앞 접수)의 번호도 찾는다 — 마지막 행만으로는 못 찾는다
      const byWaybill = needle ? await this.returnIdsByPickupWaybill(trx, needle) : new Set<string>();
      const matches = (item: CustomerReturnListItem) =>
        !needle ||
        byWaybill.has(item.id) ||
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
          const byRequested = Date.parse(x.requestedAt) - Date.parse(y.requestedAt);
          if (byRequested !== 0) return byRequested;
          return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
        });
      return { items: pool.slice(query.offset, query.offset + query.limit), total: pool.length, attentionCount };
    }, tx);
  }

  /** 그 회수 운송장번호(정확 일치)를 가진 회수 행이 있는 반품 — 상관 없는 서브쿼리다 */
  private pickupWaybillMatch(trx: DbTx, waybillNo: string): SQL {
    const t = wmsTables.customerReturnPickups;
    return inArray(
      wmsTables.customerReturns.id,
      trx.select({ id: t.customerReturnId }).from(t).where(eq(t.waybillNo, waybillNo)),
    );
  }

  private async returnIdsByPickupWaybill(trx: DbTx, waybillNo: string): Promise<Set<string>> {
    const t = wmsTables.customerReturnPickups;
    const rows = await trx.select({ id: t.customerReturnId }).from(t).where(eq(t.waybillNo, waybillNo));
    return new Set(rows.map((row) => row.id));
  }

  /** q: 주문번호·채널 주문 id·회수 운송장번호 정확 일치, 고객명 부분 일치(LIKE 메타문자는 문자 그대로) */
  private searchCondition(trx: DbTx, q?: string): SQL | undefined {
    const needle = q?.trim();
    if (!needle) return undefined;
    const escaped = needle.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    return or(
      eq(wmsTables.salesOrders.displayOrderNo, needle),
      eq(wmsTables.salesOrders.channelOrderId, needle),
      this.pickupWaybillMatch(trx, needle),
      ilike(wmsTables.salesOrders.customerName, `%${escaped}%`),
    );
  }

  /**
   * 창고 도착 대기 목록(K8 PR7b N3). `arrived` 는 W 에서 첫 도착한 것, `expected` 는 그 판매주문을 W 가 배송완료한 것
   * (도착 검증 `assertReceivingWarehouse` 와 같은 술어 — 후보 판매주문 전부를 한 번에 판정한다).
   * 단계 ready → partial → awaiting, 그다음 요청 이른 순·id 순. 진행 중 반품 수만큼이라 TS 로 판정·정렬한 뒤 자른다.
   */
  async listForReceiving(
    query: ListReceivingCustomerReturnsQueryDto,
    tx?: DbTx,
  ): Promise<{ items: CustomerReturnReceivingItem[]; total: number }> {
    return this.dbService.run(async (trx) => {
      const r = wmsTables.customerReturns;
      const so = wmsTables.salesOrders;
      const warehouseId = query.warehouseId;

      // barcode: 그 바코드(정확 일치)를 가진 SKU 의 항목이 있는 반품, 또는 그 회수 운송장번호의 반품 — 상관 없는 서브쿼리라 진행 중 후보 안에서만 거른다
      const barcode = query.barcode?.trim();
      const l = wmsTables.customerReturnLines;
      const i = wmsTables.customerReturnItems;
      const b = wmsTables.skuBarcodes;
      // 회수 운송장번호도 같은 칸으로 찾는다 — 창고 스테이션이 회수 운송장 스캔으로 반품을 연다(K8 PR9 N10)
      const withBarcode = barcode
        ? or(
            inArray(
              r.id,
              trx
                .select({ customerReturnId: l.customerReturnId })
                .from(i)
                .innerJoin(l, eq(l.id, i.customerReturnLineId))
                .innerJoin(b, eq(b.skuId, i.skuId))
                .where(eq(b.barcode, barcode)),
            ),
            this.pickupWaybillMatch(trx, barcode),
          )
        : undefined;

      const candidates = await trx
        .select({
          id: r.id,
          salesOrderId: r.salesOrderId,
          status: r.status,
          reason: r.reason,
          requestedAt: r.requestedAt,
          csResolution: r.csResolution,
          channelOrderId: so.channelOrderId,
          displayOrderNo: so.displayOrderNo,
          customerName: so.customerName,
        })
        .from(r)
        .innerJoin(so, eq(so.id, r.salesOrderId))
        .where(
          and(
            or(and(eq(r.status, 'arrived'), eq(r.warehouseId, warehouseId)), eq(r.status, 'expected')),
            this.searchCondition(trx, query.q),
            withBarcode,
          ),
        );
      if (candidates.length > OPEN_WARN_THRESHOLD) {
        this.logger.warn(`창고 반품 후보 ${candidates.length}건 — 목록이 전부 읽는다(${OPEN_WARN_THRESHOLD} 초과)`);
      }
      const delivered = await this.salesOrdersDeliveredBy(
        trx,
        warehouseId,
        candidates.filter((row) => row.status === 'expected').map((row) => row.salesOrderId),
      );
      const scoped = candidates.filter((row) => row.status === 'arrived' || delivered.has(row.salesOrderId));
      const summaries = await this.summarize(
        trx,
        scoped.map((row) => row.id),
      );

      const items = scoped
        .map((row): CustomerReturnReceivingItem => {
          const summary = summaries.get(row.id);
          const expectedQty = summary?.expectedQty ?? 0;
          const arrivedQty = summary?.arrivedQty ?? 0;
          const stage: CustomerReturnReceivingStage =
            row.status === 'expected'
              ? 'awaiting'
              : arrivedQty >= expectedQty || row.csResolution?.missing
                ? 'ready'
                : 'partial';
          return {
            id: row.id,
            orderNo: row.displayOrderNo ?? row.channelOrderId,
            customerMasked: maskName(row.customerName ?? ''),
            reason: row.reason,
            productSummary: summary?.productSummary ?? '',
            expectedQty,
            arrivedQty,
            stage,
            requestedAt: row.requestedAt.toISOString(),
          };
        })
        .sort((x, y) => {
          const byStage = RECEIVING_STAGE_ORDER[x.stage] - RECEIVING_STAGE_ORDER[y.stage];
          if (byStage !== 0) return byStage;
          const byRequested = Date.parse(x.requestedAt) - Date.parse(y.requestedAt);
          if (byRequested !== 0) return byRequested;
          return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
        });
      return { items: items.slice(0, query.limit), total: items.length };
    }, tx);
  }

  /**
   * 판매주문들 중 W 가 배송완료한 것 — `deliveredParcelsSql` 의 상자 라인 × `shipments.warehouse_id = W`.
   * 도착 검증(`assertReceivingWarehouse`)과 같은 술어를 주문마다가 아니라 한 번에 부른다.
   */
  private async salesOrdersDeliveredBy(trx: DbTx, warehouseId: string, salesOrderIds: string[]): Promise<Set<string>> {
    if (salesOrderIds.length === 0) return new Set();
    const ids = sql.join(
      [...new Set(salesOrderIds)].map((id) => sql`${id}::uuid`),
      sql`, `,
    );
    const s = wmsTables.shipments;
    const sl = wmsTables.shipmentLines;
    const foi = wmsTables.fulfillmentOrderItems;
    const fo = wmsTables.fulfillmentOrders;
    const rows = await trx
      .selectDistinct({ salesOrderId: fo.salesOrderId })
      .from(sl)
      .innerJoin(s, eq(s.id, sl.shipmentId))
      .innerJoin(foi, eq(foi.id, sl.fulfillmentOrderItemId))
      .innerJoin(fo, eq(fo.id, foi.fulfillmentOrderId))
      .where(
        and(
          eq(s.warehouseId, warehouseId),
          inArray(
            sl.id,
            sql`(select delivered_parcel.shipment_line_id from (${deliveredParcelsSql(sql`select x.id from unnest(ARRAY[${ids}]::uuid[]) as x(id)`)}) as delivered_parcel)`,
          ),
        ),
      );
    const delivered = new Set<string>();
    for (const row of rows) if (row.salesOrderId) delivered.add(row.salesOrderId);
    return delivered;
  }

  /**
   * 반품들의 줄 요약(«첫 품목 외 N건»)·줄 수량·미도착 수량과 SKU 항목 기대·도착 합.
   * 합은 반품 id 로 group by 해 따로 읽는다(조인 없는 select 의 상관 서브쿼리 금지 — `itemsOf` 주석).
   */
  private async summarize(trx: DbTx, ids: string[]): Promise<Map<string, CustomerReturnSummary>> {
    if (ids.length === 0) return new Map();
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

    return new Map(
      ids.map((id) => {
        const mine = lines.filter((line) => line.customerReturnId === id);
        const first = mine[0]?.productName ?? '';
        return [
          id,
          {
            quantity: mine.reduce((sum, line) => sum + line.quantity, 0),
            missingQty: mine.reduce((sum, line) => sum + line.missingQty, 0),
            productSummary: mine.length > 1 ? `${first} 외 ${mine.length - 1}건` : first,
            expectedQty: expectedBy.get(id) ?? 0,
            arrivedQty: arrivedBy.get(id) ?? 0,
          },
        ];
      }),
    );
  }

  /**
   * 반품들의 마지막 회수 행(`created_at desc, id desc`) — 반품 id 묶음으로 따로 읽는다(상관 서브쿼리 금지, `itemsOf` 주석).
   * 반품당 회수 행은 접수·다시 접수 횟수뿐이라 전부 읽어 TS 로 첫 행만 고른다.
   */
  private async latestPickups(
    trx: DbTx,
    ids: string[],
  ): Promise<Map<string, typeof wmsTables.customerReturnPickups.$inferSelect>> {
    const latest = new Map<string, typeof wmsTables.customerReturnPickups.$inferSelect>();
    if (ids.length === 0) return latest;
    const t = wmsTables.customerReturnPickups;
    const rows = await trx
      .select()
      .from(t)
      .where(inArray(t.customerReturnId, ids))
      .orderBy(desc(t.createdAt), desc(t.id));
    for (const row of rows) if (!latest.has(row.customerReturnId)) latest.set(row.customerReturnId, row);
    return latest;
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
    const summaries = await this.summarize(
      trx,
      rows.map((row) => row.record.id),
    );
    const pickups = await this.latestPickups(
      trx,
      rows.map((row) => row.record.id),
    );

    return rows.map(({ record, channelOrderId, displayOrderNo, customerName }) => {
      const summary = summaries.get(record.id);
      const pickup = pickups.get(record.id);
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
        quantity: summary?.quantity ?? 0,
        productSummary: summary?.productSummary ?? '',
        refundAmount: record.settlementOutcome?.refundAmount ?? null,
        pickupWaybillNo: pickup?.waybillNo ?? null,
        attention: customerReturnAttention(
          {
            status: record.status,
            arrivedAt: record.arrivedAt,
            settlementState: record.settlement?.state ?? null,
            prepaymentState: record.prepayment?.state ?? null,
            expectedQty: summary?.expectedQty ?? 0,
            arrivedQty: summary?.arrivedQty ?? 0,
            missingQty: summary?.missingQty ?? 0,
            pickupStatus: pickup?.status ?? null,
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

      const pickup = (await this.latestPickups(trx, [id])).get(id);

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
        kind: record.kind,
        exchangeReleasedAt: record.exchangeReleasedAt?.toISOString() ?? null,
        reason: record.reason,
        note: record.note,
        feeBearer: record.feeBearer,
        requestedBy: record.requestedBy,
        warehouseId: record.warehouseId,
        windowOverrideReason: record.windowOverrideReason ?? null,
        requestedAt: record.requestedAt.toISOString(),
        cancelledAt: record.cancelledAt?.toISOString() ?? null,
        arrivedAt: record.arrivedAt?.toISOString() ?? null,
        refundDueAt: record.arrivedAt ? refundDueAt(record.arrivedAt).toISOString() : null,
        inspectedAt: record.inspectedAt?.toISOString() ?? null,
        inspectedBy: record.inspectedBy ?? null,
        settledAt: record.settledAt?.toISOString() ?? null,
        settlement: record.settlement ?? null,
        settlementOutcome: record.settlementOutcome ?? null,
        prepayment: record.prepayment ?? null,
        pickup: pickup ? pickupView(pickup) : null,
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
              barcodes: item.barcodes,
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
    // 바코드도 따로 읽는다 — 항목마다 SKU 바코드가 여럿이라 조인하면 행이 곱해진다
    const b = wmsTables.skuBarcodes;
    const barcodeRows = await trx
      .select({ skuId: b.skuId, barcode: b.barcode })
      .from(b)
      .where(
        inArray(
          b.skuId,
          items.map((item) => item.skuId),
        ),
      )
      .orderBy(desc(b.isPrimary), asc(b.barcode));
    const barcodesBySku = new Map<string, string[]>();
    for (const row of barcodeRows) barcodesBySku.set(row.skuId, [...(barcodesBySku.get(row.skuId) ?? []), row.barcode]);
    return items.map((item) => ({
      ...item,
      arrivedQty: arrivedByItem.get(item.id) ?? 0,
      barcodes: barcodesBySku.get(item.skuId) ?? [],
    }));
  }
}
