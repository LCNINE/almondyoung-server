import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { InjectTypedDb } from '@app/db/decorators';
import { and, asc, desc, eq, ilike, isNull, lt, ne, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { wmsSchema, wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { type PrintOrderRow } from '../schema/print-order.schema';

export const PRINT_ORDER_TABS = ['cancel_refused', 'test_pending', 'failed', 'unsupported', 'all'] as const;
export type PrintOrderTab = (typeof PRINT_ORDER_TABS)[number];
export const PRINT_ORDER_PAGE_SIZE = 50;
export const PRINT_ORDER_MAX_PAGE_SIZE = 100;
export const PRINT_ORDER_MAX_PAGE = 10_000;

export interface PrintOrderSummary {
  cancelRefused: number;
  testPending: number;
  failed: number;
  unsupported: number;
  total: number;
}

export interface PrintOrderListItem extends PrintOrderRow {
  channelOrderId: string;
  displayOrderNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productName: string;
  salesCancelFailed: boolean;
}

export interface PrintOrderListQuery {
  tab: PrintOrderTab;
  q: string;
  page: number;
  pageSize: number;
}

// 연락처는 하이픈·공백·+82 표기가 섞여 저장된다. 숫자만 남기고, 82 로 시작하는 국제 표기(10자리 이상)는 앞의 82 를 0 으로 바꾼다.
// 아래 SQL(storedPhoneDigits)과 같은 규칙이다
const COUNTRY_CODE = '82';
const MIN_INTERNATIONAL_DIGITS = 10;

export function phoneDigits(value: string): string {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.startsWith(COUNTRY_CODE) && digits.length >= MIN_INTERNATIONAL_DIGITS
    ? `0${digits.slice(COUNTRY_CODE.length)}`
    : digits;
}

export function storedPhoneDigits(column: SQLWrapper): SQL {
  const digits = sql`regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g')`;
  return sql`(CASE WHEN starts_with(${digits}, ${COUNTRY_CODE}) AND length(${digits}) >= ${MIN_INTERNATIONAL_DIGITS} THEN '0' || substr(${digits}, ${COUNTRY_CODE.length + 1}) ELSE ${digits} END)`;
}

// 판매주문 부분취소가 줄마다 취소한 수량. SalesOrdersService.getCancelledQuantityByLine 과 같은 계산(partial 취소 metadata.cancelledLines 합)이다
export function cancelledQuantitySql(salesOrderId: SQLWrapper, salesOrderLineId: SQLWrapper): SQL {
  const c = wmsTables.salesOrderCancellations;
  return sql`coalesce((
    select sum((cl.value->>'quantity')::numeric)
    from ${c}
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(${c.metadata}->'cancelledLines') = 'array' then ${c.metadata}->'cancelledLines' else '[]'::jsonb end
    ) as cl(value)
    where ${c.salesOrderId} = ${salesOrderId}
      and ${c.cancellationScope} = 'partial'
      and jsonb_typeof(cl.value) = 'object'
      and jsonb_typeof(cl.value->'quantity') = 'number'
      and cl.value->>'salesOrderLineId' = (${salesOrderLineId})::text
  ), 0)`;
}

// 인쇄는 취소됐는데 판매주문 줄에 아직 취소되지 않은 수량이 남은 행(환불이 열리지 않음). 기록이 아니라 지금 상태에서 구한다
export function refundNotOpenedSql(): SQL {
  const t = wmsTables.printOrders;
  const orders = wmsTables.salesOrders;
  const lines = wmsTables.salesOrderLines;
  return sql`(${t.status} = 'cancelled' and ${orders.status} <> 'cancelled' and ${lines.quantity} > ${cancelledQuantitySql(t.salesOrderId, lines.id)})`;
}

export interface PrintSalesLineState {
  salesOrderStatus: string;
  lineStatus: string;
  quantity: number;
}

@Injectable()
export class PrintOrderReader {
  constructor(
    @InjectTypedDb<typeof wmsSchema>()
    private readonly dbService: DbService<typeof wmsSchema>,
  ) {}

  forSalesOrder(salesOrderId: string, tx?: DbTx): Promise<PrintOrderRow[]> {
    const t = wmsTables.printOrders;
    return this.dbService.run(
      (trx) => trx.select().from(t).where(eq(t.salesOrderId, salesOrderId)).orderBy(asc(t.createdAt)),
      tx,
    );
  }

  // 주문의 모든 라인이 인쇄 외주 라인인가 (창고 출고가 전혀 없는 주문)
  async isAllOutsourced(salesOrderId: string, tx?: DbTx): Promise<boolean> {
    const lines = wmsTables.salesOrderLines;
    const [row] = await this.dbService.run(
      (trx) =>
        trx
          .select({
            total: sql<number>`count(*)::int`,
            warehouse: sql<number>`count(*) filter (where ${isNull(lines.almondDesignId)})::int`,
          })
          .from(lines)
          .where(eq(lines.salesOrderId, salesOrderId)),
      tx,
    );
    return (row?.total ?? 0) > 0 && (row?.warehouse ?? 0) === 0;
  }

  async summary(staleCancellingBefore: Date, tx?: DbTx): Promise<PrintOrderSummary> {
    const t = wmsTables.printOrders;
    const count = (where: SQL | undefined) => sql<number>`count(*) filter (where ${where})::int`;
    const [row] = await this.dbService.run(
      (trx) =>
        trx
          .select({
            cancelRefused: count(this.tabWhere('cancel_refused', staleCancellingBefore)),
            testPending: count(this.tabWhere('test_pending', staleCancellingBefore)),
            failed: count(this.tabWhere('failed', staleCancellingBefore)),
            unsupported: count(this.tabWhere('unsupported', staleCancellingBefore)),
            total: sql<number>`count(*)::int`,
          })
          .from(t)
          .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, t.salesOrderId))
          .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.id, t.salesOrderLineId)),
      tx,
    );
    return {
      cancelRefused: row?.cancelRefused ?? 0,
      testPending: row?.testPending ?? 0,
      failed: row?.failed ?? 0,
      unsupported: row?.unsupported ?? 0,
      total: row?.total ?? 0,
    };
  }

  async list(
    query: PrintOrderListQuery,
    staleCancellingBefore: Date,
    tx?: DbTx,
  ): Promise<{ items: PrintOrderListItem[]; total: number }> {
    const t = wmsTables.printOrders;
    const where = and(this.tabWhere(query.tab, staleCancellingBefore), this.searchWhere(query.q));
    return this.dbService.run(async (trx) => {
      const rows = await this.listSelect(trx)
        .where(where)
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);
      const [counted] = await trx
        .select({ total: sql<number>`count(*)::int` })
        .from(t)
        .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, t.salesOrderId))
        .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.id, t.salesOrderLineId))
        .where(where);
      return { items: rows.map(toListItem), total: counted?.total ?? 0 };
    }, tx);
  }

  async byLine(salesOrderLineId: string, tx?: DbTx): Promise<PrintOrderListItem | null> {
    const t = wmsTables.printOrders;
    const [row] = await this.dbService.run(
      (trx) => this.listSelect(trx).where(eq(t.salesOrderLineId, salesOrderLineId)),
      tx,
    );
    return row ? toListItem(row) : null;
  }

  // 같은 시안을 여러 번 주문할 수 있어 배열이다. 최신 순
  async byDesign(almondDesignId: string, tx?: DbTx): Promise<PrintOrderListItem[]> {
    const t = wmsTables.printOrders;
    const rows = await this.dbService.run(
      (trx) => this.listSelect(trx).where(eq(t.almondDesignId, almondDesignId)).orderBy(desc(t.createdAt), desc(t.id)),
      tx,
    );
    return rows.map(toListItem);
  }

  async refundNotOpened(printOrderId: string, tx?: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    const [row] = await this.dbService.run(
      (trx) =>
        trx
          .select({ pending: sql<boolean>`${refundNotOpenedSql()}` })
          .from(t)
          .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, t.salesOrderId))
          .innerJoin(wmsTables.salesOrderLines, eq(wmsTables.salesOrderLines.id, t.salesOrderLineId))
          .where(eq(t.id, printOrderId)),
      tx,
    );
    return row?.pending === true;
  }

  async salesLine(salesOrderLineId: string, tx?: DbTx): Promise<PrintSalesLineState | null> {
    const lines = wmsTables.salesOrderLines;
    const orders = wmsTables.salesOrders;
    const [row] = await this.dbService.run(
      (trx) =>
        trx
          .select({ salesOrderStatus: orders.status, lineStatus: lines.status, quantity: lines.quantity })
          .from(lines)
          .innerJoin(orders, eq(orders.id, lines.salesOrderId))
          .where(eq(lines.id, salesOrderLineId)),
      tx,
    );
    return row ?? null;
  }

  private listSelect(trx: DbTx) {
    const t = wmsTables.printOrders;
    const orders = wmsTables.salesOrders;
    const lines = wmsTables.salesOrderLines;
    return trx
      .select({
        printOrder: t,
        channelOrderId: orders.channelOrderId,
        displayOrderNo: orders.displayOrderNo,
        customerName: orders.customerName,
        customerPhone: orders.customerPhone,
        productName: lines.productName,
        salesCancelFailed: sql<boolean>`${refundNotOpenedSql()}`,
      })
      .from(t)
      .innerJoin(orders, eq(orders.id, t.salesOrderId))
      .innerJoin(lines, eq(lines.id, t.salesOrderLineId))
      .$dynamic();
  }

  // 취소 확인 필요에는 결과를 모른 채 오래 남은 cancelling 행도 넣는다
  private tabWhere(tab: PrintOrderTab, staleCancellingBefore: Date): SQL | undefined {
    const t = wmsTables.printOrders;
    switch (tab) {
      case 'cancel_refused':
        // 결과 미상 cancelling, 인쇄는 취소됐는데 판매주문 줄에 남은 수량이 있는 행도 여기서 사람이 본다
        return or(
          eq(t.status, 'cancel_refused'),
          and(eq(t.status, 'cancelling'), lt(t.updatedAt, staleCancellingBefore)),
          refundNotOpenedSql(),
        );
      case 'test_pending':
        return and(eq(t.testMemo, true), isNull(t.testConfirmedAt), ne(t.status, 'cancelled'));
      case 'failed':
        return eq(t.status, 'failed');
      case 'unsupported':
        return eq(t.status, 'unsupported');
      case 'all':
        return undefined;
    }
  }

  private searchWhere(q: string): SQL | undefined {
    const term = q.trim();
    if (!term) return undefined;
    const t = wmsTables.printOrders;
    const orders = wmsTables.salesOrders;
    const pattern = `%${escapeLike(term)}%`;
    const phone = phoneDigits(term);
    return or(
      ilike(orders.channelOrderId, pattern),
      ilike(orders.displayOrderNo, pattern),
      ilike(orders.customerName, pattern),
      phone.length >= 3 ? sql`${storedPhoneDigits(orders.customerPhone)} LIKE ${`%${phone}%`}` : undefined,
      ilike(t.vendorOrderNumber, pattern),
      ilike(wmsTables.salesOrderLines.productName, pattern),
    );
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function toListItem(row: {
  printOrder: PrintOrderRow;
  channelOrderId: string;
  displayOrderNo: string | null;
  customerName: string | null;
  customerPhone: string | null;
  productName: string;
  salesCancelFailed: boolean;
}): PrintOrderListItem {
  return {
    ...row.printOrder,
    channelOrderId: row.channelOrderId,
    displayOrderNo: row.displayOrderNo,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    productName: row.productName,
    salesCancelFailed: row.salesCancelFailed === true,
  };
}
