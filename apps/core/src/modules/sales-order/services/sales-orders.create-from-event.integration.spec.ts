import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb, makeDbService, inRollbackTx } from '../../fulfillment/services/__support__';
import { SalesOrdersService } from './sales-orders.service';
import type { OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * createFromEvent 는 라인 없이 부르면 policies·매칭 계열을 타지 않는다. 실제로 쓰는 건
 * db 와 아웃박스 enqueue 뿐이라 나머지는 빈 목으로 충분하다.
 */
function makeService(db: PostgresJsDatabase<typeof wmsSchema>): SalesOrdersService {
  const noop = {} as never;
  const outbox = { enqueue: async () => undefined } as never;
  return new SalesOrdersService(makeDbService(db), noop, outbox, noop, noop, noop, noop, noop);
}

function payload(over: Partial<OrderCreatedPayload> = {}): OrderCreatedPayload {
  return {
    orderId: randomUUID(),
    externalOrderId: `order_${randomUUID().slice(0, 12)}`,
    salesChannel: 'medusa',
    customerId: null,
    items: [],
    totalAmount: 10000,
    subtotalAmount: 10000,
    shippingAmount: 0,
    discountAmount: 0,
    currency: 'KRW',
    shippingAddress: {
      recipientName: '수령인',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '어딘가',
      detailAddress: '101호',
    },
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...over,
  } as OrderCreatedPayload;
}

describeIfDb('SalesOrdersService.createFromEvent — 채널이 준 값을 흘리지 않는다 (DB integration, rollback-only)', () => {
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL!));
  });
  afterAll(async () => {
    await sql.end();
  });

  const read = (tx: any, id: string) =>
    tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, id)).limit(1);

  it('고객 주문번호(displayOrderNo)와 이메일을 저장한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const svc = makeService(db);
      const created = await svc.createFromEvent(
        payload({ displayOrderNo: '3900', email: 'buyer@example.com' }),
        tx,
      );
      const [row] = await read(tx, created.id);
      expect(row.displayOrderNo).toBe('3900');
      expect(row.customerEmail).toBe('buyer@example.com');
    });
  });

  it('채널이 고객 주문번호를 안 주면 NULL — 내부 ID 를 대신 넣지 않는다', async () => {
    await inRollbackTx(db, async (tx) => {
      const svc = makeService(db);
      const p = payload();
      const created = await svc.createFromEvent(p, tx);
      const [row] = await read(tx, created.id);
      expect(row.displayOrderNo).toBeNull();
      expect(row.channelOrderId).toBe(p.externalOrderId);
    });
  });

  it('customer_name 은 «배송지 이름»이다 — 주문자 신원으로 읽으면 안 된다', async () => {
    await inRollbackTx(db, async (tx) => {
      const svc = makeService(db);
      const created = await svc.createFromEvent(
        payload({
          customerId: randomUUID(),
          shippingAddress: {
            recipientName: '받는사람',
            phone: '01011112222',
            postalCode: '00000',
            roadAddress: '어딘가',
            detailAddress: '101호',
          } as OrderCreatedPayload['shippingAddress'],
        }),
        tx,
      );
      const [row] = await read(tx, created.id);
      expect(row.customerName).toBe('받는사람');
      expect(row.customerId).not.toBeNull();
    });
  });
});
