import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, inRollbackTx } from '../../fulfillment/services/__support__';
import { SalesOrdersService } from './sales-orders.service';
import type { SalesOrderFilterDto } from '../dto/sales-order-filter.dto';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// list() 는 this.db.run(fn, tx) 만 쓰므로 나머지 의존성은 미사용 → 빈 목으로 충분.
function makeService(db: PostgresJsDatabase<typeof wmsSchema>): SalesOrdersService {
  const noop = {} as never;
  return new SalesOrdersService(makeDbService(db), noop, noop, noop, noop, noop, noop);
}

async function insertOrder(
  tx: DbTx,
  o: Partial<{
    status: 'pending' | 'confirmed' | 'cancelled' | 'timeout';
    orderDate: Date;
    channelOrderId: string;
    customerName: string | null;
    customerPhone: string | null;
    salesChannel: 'medusa' | 'naver' | 'coupang' | '3pl';
    shippingAddress: unknown;
  }> = {},
): Promise<string> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: o.channelOrderId ?? `IT-${randomUUID().slice(0, 12)}`,
      salesChannel: o.salesChannel ?? 'medusa',
      status: o.status ?? 'confirmed',
      shippingAddress: o.shippingAddress ?? { recipientName: 'RCPT', phone: '01000000000' },
      customerName: o.customerName ?? null,
      customerPhone: o.customerPhone ?? null,
      orderDate: o.orderDate ?? new Date(),
    })
    .returning();
  return so.id;
}

async function insertLine(
  tx: DbTx,
  salesOrderId: string,
  l: Partial<{
    status: 'pending' | 'matched' | 'stock_deducted' | 'stock_unavailable' | 'cancelled';
    productMatchingId: string | null;
    productName: string;
  }> = {},
): Promise<void> {
  await tx.insert(wmsTables.salesOrderLines).values({
    salesOrderId,
    variantId: randomUUID(),
    productName: l.productName ?? 'IT Product',
    quantity: 1,
    unitPrice: 1000,
    status: l.status ?? 'pending',
    productMatchingId: l.productMatchingId ?? null,
  });
}

async function insertRefundLink(
  tx: DbTx,
  salesOrderId: string,
  refundStatus: string,
  createdAt: Date,
  extraMeta: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await tx
    .insert(wmsTables.businessLinks)
    .values({
      sourceType: 'sales_order',
      sourceId: salesOrderId,
      targetType: 'wallet_refund',
      targetId: randomUUID(),
      relationName: 'cancellation_linked_wallet_refund',
      metadata: { refundStatus, ...extraMeta },
      occurredAt: createdAt,
      createdAt,
    })
    .returning();
  return row.id;
}

describeIfDb('SalesOrdersService.list — server-side filters (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  const run = (fn: (tx: DbTx, svc: SalesOrdersService, tag: string) => Promise<void>) =>
    inRollbackTx(db, async (tx) => {
      // 이 테스트가 만든 주문만 조회하도록 유니크 채널 접두사로 격리
      const tag = `TAG-${randomUUID().slice(0, 8)}`;
      await fn(tx, makeService(db), tag);
    });

  const listByKeyword = (svc: SalesOrdersService, tx: DbTx, extra: Partial<SalesOrderFilterDto>) =>
    svc.list({ limit: 100, offset: 0, keyword: undefined, ...extra } as SalesOrderFilterDto, tx);

  it('KST 달력일 경계로 필터한다 (00:30 KST 포함, 익일 00:30 제외)', async () => {
    await run(async (tx, svc, tag) => {
      // KST 2026-07-22 00:30 == UTC 2026-07-21 15:30
      const inDay = await insertOrder(tx, {
        channelOrderId: `${tag}-in`,
        orderDate: new Date('2026-07-21T15:30:00.000Z'),
      });
      // KST 2026-07-23 00:30 == UTC 2026-07-22 15:30 (다음날)
      await insertOrder(tx, {
        channelOrderId: `${tag}-out`,
        orderDate: new Date('2026-07-22T15:30:00.000Z'),
      });

      const res = await listByKeyword(svc, tx, {
        startDate: '2026-07-22',
        endDate: '2026-07-22',
        keyword: tag,
      });
      const ids = res.data.map((d: { id: string }) => d.id);
      expect(ids).toContain(inDay);
      expect(res.data).toHaveLength(1);
    });
  });

  it('typeGroup: ready / partial / hold 를 라인 상태로 구분한다', async () => {
    await run(async (tx, svc, tag) => {
      const ready = await insertOrder(tx, { channelOrderId: `${tag}-ready` });
      await insertLine(tx, ready, { status: 'stock_deducted' });
      await insertLine(tx, ready, { status: 'stock_deducted' });

      const partial = await insertOrder(tx, { channelOrderId: `${tag}-partial` });
      await insertLine(tx, partial, { status: 'stock_deducted' });
      await insertLine(tx, partial, { status: 'pending' });

      const hold = await insertOrder(tx, { channelOrderId: `${tag}-hold` });
      await insertLine(tx, hold, { status: 'stock_unavailable' });

      const readyRes = await listByKeyword(svc, tx, { keyword: tag, typeGroup: 'ready' });
      expect(readyRes.data.map((d: { id: string }) => d.id)).toEqual([ready]);

      const partialRes = await listByKeyword(svc, tx, { keyword: tag, typeGroup: 'partial' });
      expect(partialRes.data.map((d: { id: string }) => d.id)).toEqual([partial]);

      const holdRes = await listByKeyword(svc, tx, { keyword: tag, typeGroup: 'hold' });
      expect(holdRes.data.map((d: { id: string }) => d.id)).toEqual([hold]);
    });
  });

  it('typeGroup: unmatched 는 미매칭 라인이 있는 주문만', async () => {
    await run(async (tx, svc, tag) => {
      const [matching] = await tx
        .insert(wmsTables.productMatchings)
        .values({ variantId: randomUUID(), status: 'matched', strategy: 'variant', isResolved: true })
        .returning();

      const unmatched = await insertOrder(tx, { channelOrderId: `${tag}-unmatched` });
      await insertLine(tx, unmatched, { productMatchingId: null });

      const matched = await insertOrder(tx, { channelOrderId: `${tag}-matched` });
      await insertLine(tx, matched, { productMatchingId: matching.id });

      const res = await listByKeyword(svc, tx, { keyword: tag, typeGroup: 'unmatched' });
      expect(res.data.map((d: { id: string }) => d.id)).toEqual([unmatched]);
    });
  });

  it('keyword: 상품명 / 수령자 / 주문번호 대상별 검색', async () => {
    await run(async (tx, svc, tag) => {
      const byProduct = await insertOrder(tx, { channelOrderId: `${tag}-p` });
      await insertLine(tx, byProduct, { productName: `${tag}-바나나킥` });

      const byReceiver = await insertOrder(tx, {
        channelOrderId: `${tag}-r`,
        shippingAddress: { recipientName: `${tag}-홍길동`, phone: '01011112222' },
      });
      await insertLine(tx, byReceiver, {});

      const productRes = await listByKeyword(svc, tx, {
        keyword: `${tag}-바나나킥`,
        keywordType: 'product',
      });
      expect(productRes.data.map((d: { id: string }) => d.id)).toEqual([byProduct]);

      const receiverRes = await listByKeyword(svc, tx, {
        keyword: `${tag}-홍길동`,
        keywordType: 'receiver',
      });
      expect(receiverRes.data.map((d: { id: string }) => d.id)).toEqual([byReceiver]);

      const orderNoRes = await listByKeyword(svc, tx, {
        keyword: `${tag}-p`,
        keywordType: 'orderNo',
      });
      expect(orderNoRes.data.map((d: { id: string }) => d.id)).toEqual([byProduct]);
    });
  });

  it('refundIssueOnly: 어드민 화면과 동일 규칙 (미완료 manual_pending 또는 최신 failed; 정식 종결만 제외)', async () => {
    await run(async (tx, svc, tag) => {
      // ① 최신이 manual_pending → 포함
      const pending = await insertOrder(tx, { channelOrderId: `${tag}-pending`, status: 'cancelled' });
      await insertRefundLink(tx, pending, 'failed', new Date('2026-01-01T00:00:00Z'));
      await insertRefundLink(tx, pending, 'manual_pending', new Date('2026-01-02T00:00:00Z'));

      // ② manual_pending 을 완결(completedRefundLinkId 로 종결)한 succeeded → 제외
      const completed = await insertOrder(tx, { channelOrderId: `${tag}-completed`, status: 'cancelled' });
      const mpLinkId = await insertRefundLink(tx, completed, 'manual_pending', new Date('2026-01-01T00:00:00Z'));
      await insertRefundLink(tx, completed, 'succeeded', new Date('2026-01-03T00:00:00Z'), {
        completedRefundLinkId: mpLinkId,
      });

      // ③ 미완료 manual_pending + 뒤에 '무관한' succeeded(다른 링크를 완결) → 여전히 미처리라 포함
      const unrelated = await insertOrder(tx, { channelOrderId: `${tag}-unrelated`, status: 'cancelled' });
      await insertRefundLink(tx, unrelated, 'manual_pending', new Date('2026-01-01T00:00:00Z'));
      await insertRefundLink(tx, unrelated, 'succeeded', new Date('2026-01-03T00:00:00Z'), {
        completedRefundLinkId: randomUUID(), // 이 주문의 manual_pending 을 가리키지 않음
      });

      // ④ failed(t1) 후 무관 succeeded(t2, 최신) → 최신이 failed 아님·미완료 mp 없음 → 제외
      const retried = await insertOrder(tx, { channelOrderId: `${tag}-retried`, status: 'cancelled' });
      await insertRefundLink(tx, retried, 'failed', new Date('2026-01-01T00:00:00Z'));
      await insertRefundLink(tx, retried, 'succeeded', new Date('2026-01-02T00:00:00Z'));

      const res = await listByKeyword(svc, tx, { keyword: tag, refundIssueOnly: true });
      expect(res.data.map((d: { id: string }) => d.id).sort()).toEqual([pending, unrelated].sort());
    });
  });

  it('total 은 주문 수, lineTotal 은 라인 수 를 반환한다', async () => {
    await run(async (tx, svc, tag) => {
      const o1 = await insertOrder(tx, { channelOrderId: `${tag}-1` });
      await insertLine(tx, o1, {});
      await insertLine(tx, o1, {});
      const o2 = await insertOrder(tx, { channelOrderId: `${tag}-2` });
      await insertLine(tx, o2, {});

      const res = await listByKeyword(svc, tx, { keyword: tag });
      expect(res.total).toBe(2);
      expect(res.lineTotal).toBe(3);
    });
  });
});
